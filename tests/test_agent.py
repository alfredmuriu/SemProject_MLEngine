"""Tests for the data shaping, the agent and the API.

They train on small made-up flocks that follow a laying curve like the real
one (a rise to a peak around 28 weeks, then a slow decline), so they run
offline and fast without the real dataset.
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from ml_engine import api, model
from ml_engine.agent import FlockAgent
from ml_engine.data import FEATURES, HORIZONS, derive, forecast_row, training_table

AGES = range(19, 71)
CURVE = {a: round(min(94.0, 10 + 12 * (a - 19)) - max(0, a - 30) * 0.45, 2) for a in AGES}


def make_flock(rng, offset=0.0, hens=1500, start=19, end=70):
    """Weekly records for one flock laying `offset` points off the curve."""
    weeks, alive = [], hens
    for age in range(start, end + 1):
        deaths = int(rng.integers(0, 3))
        alive -= deaths
        rate = CURVE[age] + offset + rng.normal(0, 1.0)
        rate = float(np.clip(rate, 0, 100))
        weeks.append(
            {
                "age_weeks": age,
                "hens": alive,
                "eggs": int(rate / 100 * 7 * alive),
                "feed_kg": round(alive * 0.115 * 7, 1),
                "deaths": deaths,
            }
        )
    return weeks


@pytest.fixture(scope="module")
def bundle():
    rng = np.random.default_rng(0)
    flocks = {f"F{i}": make_flock(rng, offset=rng.uniform(-3, 3)) for i in range(6)}
    horizons = {}
    for h in HORIZONS:
        table = training_table(flocks, h, CURVE)
        fitted = model.CANDIDATES["Ridge regression"]().fit(table[FEATURES], table["target"])
        results = {"Ridge regression": {"mae": 1.0, "r2": 0.9, "p80_error": 2.0}}
        horizons[h] = {"model": fitted, "model_name": "Ridge regression", "results": results, "n_rows": len(table)}
    return {"horizons": horizons, "standard_curve": CURVE, "features": FEATURES, "n_flocks": 6,
            "n_weeks": 6 * len(AGES), "sklearn_version": "test"}


@pytest.fixture(scope="module")
def agent(bundle):
    return FlockAgent(bundle)


def test_derive_works_out_rates():
    weeks = [{"age_weeks": 30, "hens": 1000, "eggs": 6300, "feed_kg": 840.0, "deaths": 10}]
    row = derive(weeks, CURVE).iloc[0]
    assert row["lay_rate"] == pytest.approx(90.0)
    assert row["feed_g"] == pytest.approx(120.0)
    assert row["mortality_pct"] == pytest.approx(100 * 10 / 1010)
    assert row["feed_kg_per_dozen"] == pytest.approx(840 / 525)


def test_deaths_worked_out_from_hens_when_left_out():
    weeks = [{"age_weeks": a, "hens": h, "eggs": 5000, "feed_kg": 800.0} for a, h in [(30, 1000), (31, 990), (32, 990)]]
    assert derive(weeks, CURVE)["deaths"].tolist() == [0, 10, 0]


def test_weeks_must_be_consecutive():
    weeks = [{"age_weeks": a, "hens": 1000, "eggs": 6000, "feed_kg": 800.0} for a in (30, 31, 33)]
    with pytest.raises(ValueError, match="consecutive"):
        derive(weeks, CURVE)


def test_training_rows_never_use_the_future():
    rng = np.random.default_rng(1)
    table = training_table({"A": make_flock(rng)}, 4, CURVE)
    # the target is 4 weeks after the row; features stop at the row's own week
    assert (table["target_age_weeks"] - table["age_weeks"] == 4).all()
    assert table["age_weeks"].min() == 21  # needs this week and the two before it
    assert table["target_age_weeks"].max() == 70  # the curve ends at 70


def test_no_forecast_past_the_trained_ages(agent):
    rng = np.random.default_rng(2)
    weeks = make_flock(rng, start=60, end=66)
    horizons = [f["horizon_weeks"] for f in agent.forecast(weeks)]
    assert horizons == [1, 4]  # 66 + 8 = 74 is past the curve
    assert forecast_row(weeks, 8, CURVE) is None


def test_on_track_flock_needs_no_action(agent):
    report = agent.review(make_flock(np.random.default_rng(3), end=40))
    assert report["flags"] == []
    assert report["actions"][0].startswith("No action needed")
    assert report["expected_eggs_next_week"] > 0
    assert len(report["history"]) == 22


def test_flock_well_below_standard_is_flagged(agent):
    report = agent.review(make_flock(np.random.default_rng(4), offset=-12, end=45))
    assert "below_standard" in report["flags"]
    assert report["actions"][0].startswith("Laying is")


class FixedForecast:
    """Stands in for a fitted model: always forecasts the same laying rate."""

    def __init__(self, value):
        self.value = value

    def predict(self, X):
        return np.full(len(X), self.value)


def stub_bundle(bundle, forecast):
    horizons = {h: {**e, "model": FixedForecast(forecast)} for h, e in bundle["horizons"].items()}
    return {**bundle, "horizons": horizons}


def test_falling_flock_gets_an_early_warning(bundle):
    # on track this week, but the 4-week forecast is well under the standard
    weeks = make_flock(np.random.default_rng(5), end=44)
    report = FlockAgent(stub_bundle(bundle, forecast=CURVE[48] - 10)).review(weeks)
    assert report["latest"]["gap"] > -5
    assert report["flags"] == ["falling_behind"]
    assert report["actions"][0].startswith("On track now")


def test_below_standard_says_whether_it_recovers(bundle):
    weeks = make_flock(np.random.default_rng(5), offset=-10, end=44)
    recovers = FlockAgent(stub_bundle(bundle, forecast=CURVE[48])).review(weeks)
    assert recovers["flags"] == ["below_standard", "recovering"]
    assert "expects it to recover" in recovers["actions"][0]
    stays = FlockAgent(stub_bundle(bundle, forecast=CURVE[48] - 10)).review(weeks)
    assert stays["flags"] == ["below_standard"]
    assert "expects it to stay behind" in stays["actions"][0]


def test_high_mortality_and_feed_are_flagged(agent):
    weeks = make_flock(np.random.default_rng(6), end=40)
    weeks[-1] = {**weeks[-1], "deaths": 30, "feed_kg": weeks[-1]["eggs"] / 12 * 2.5}
    report = agent.review(weeks)
    assert "high_mortality" in report["flags"]
    assert "poor_feed_efficiency" in report["flags"]


def test_review_needs_three_weeks(agent):
    with pytest.raises(ValueError, match="at least 3"):
        agent.review(make_flock(np.random.default_rng(7), end=20))


@pytest.fixture
def client(bundle):
    api.app.dependency_overrides[api.get_bundle] = lambda: bundle
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


def test_api_review_and_forecast(client):
    weeks = make_flock(np.random.default_rng(8), end=35)
    for w in weeks:
        w.pop("deaths")  # the API works them out
    r = client.post("/flock/review", json={"flock_id": "House 1", "weeks": weeks})
    assert r.status_code == 200
    body = r.json()
    assert body["flock_id"] == "House 1"
    assert [f["horizon_weeks"] for f in body["forecasts"]] == [1, 4, 8]
    f = client.post("/forecast", json={"weeks": weeks}).json()["forecasts"][0]
    assert f["low"] <= f["lay_rate"] <= f["high"]


def test_api_rejects_bad_records(client):
    weeks = make_flock(np.random.default_rng(9), end=25)
    del weeks[2]
    r = client.post("/flock/review", json={"weeks": weeks})
    assert r.status_code == 422
    assert "consecutive" in r.json()["detail"]
    assert client.post("/flock/review", json={"weeks": [{"age_weeks": 30, "hens": 0, "eggs": 1, "feed_kg": 1}]}).status_code == 422


def test_web_app_and_its_endpoints(client):
    assert "FlockWise" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    sample = client.get("/sample-flock").json()
    assert len(sample["weeks"]) >= 3
    assert client.post("/flock/review", json={"weeks": sample["weeks"]}).status_code == 200
    info = client.get("/model").json()
    assert info["n_flocks"] == 6 and [h["horizon_weeks"] for h in info["horizons"]] == [1, 4, 8]
    assert client.get("/standard-curve").json()[0] == {"age_weeks": 19, "standard": CURVE[19]}
