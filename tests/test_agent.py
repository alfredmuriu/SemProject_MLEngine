"""Tests for the agent and API.

They train on a small made-up flock that follows the same pattern as the
Kaggle data (hens past ~950 days stop laying), so they run offline and
without the real dataset.
"""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from ml_engine import api, model
from ml_engine.agent import FlockAgent
from ml_engine.data import FEATURES, to_feature_frame


@pytest.fixture(scope="module")
def agent():
    rng = np.random.default_rng(0)
    n = 200
    birds = pd.DataFrame(
        {
            "Age": rng.integers(20, 1000, n),
            "GallusWeight": rng.integers(1500, 3000, n),
            "GallusEggWeight": rng.uniform(30, 59, n).round(2),
            "AmountOfFeed": rng.integers(100, 130, n),
            "SunLightExposure": rng.integers(5, 12, n),
            "GallusBreed": rng.choice(["Marans", "Ameraucana"], n),
            "GallusEggColor": "Brown",
            "GallusCombType": "Single",
            "GallusLegShanksColor": "White",
            "GallusBeakColor": "White",
            "GallusPlumage": rng.choice(["Blue", "Splash"], n),
        }
    )
    eggs = (birds["Age"] < 950).astype(int)
    pipeline = model.build_pipeline().fit(to_feature_frame(birds[FEATURES]), eggs)
    return FlockAgent(pipeline)


def bird(bird_id, age, collected=None, feed=115):
    return {"GallusID": bird_id, "Age": age, "AmountOfFeed": feed, "EggsCollected": collected}


def flags(report):
    return {b["GallusID"]: b["flags"] for b in report["birds"]}


def test_young_hen_expected_to_lay_old_hen_not(agent):
    young, old = agent.expected_eggs([bird("a", 400), bird("b", 990)])
    assert young > 0.9
    assert old < 0.1


def test_flags_each_situation(agent):
    report = agent.review_day(
        [
            bird("fine", 400, collected=1),
            bird("missed", 500, collected=0),
            bird("ending", 935, collected=1),
            bird("done", 985, collected=0, feed=120),
        ]
    )
    assert flags(report) == {
        "fine": [],
        "missed": ["missed_lay"],
        "ending": ["end_of_lay_soon"],
        "done": ["not_expected_to_lay"],
    }
    assert report["summary"]["eggs_collected"] == 2
    assert report["summary"]["feed_g_on_non_layers"] == 120
    # one action per flagged bird; the egg "missed" didn't lay is explained by
    # its own flag, so there is no extra flock-level warning
    assert report["summary"]["unexplained_shortfall"] < 1
    assert len(report["actions"]) == 3


class FixedPredictions:
    """Stands in for the trained pipeline - every bird gets the same value."""

    def __init__(self, value):
        self.value = value

    def predict(self, X):
        return np.full(len(X), self.value)


def test_flock_shortfall_no_bird_explains():
    # Ten birds the model is only moderately sure about (0.7): none is
    # confident enough to flag on its own, but 5 eggs against 7 expected is a
    # flock-wide problem.
    agent = FlockAgent(FixedPredictions(0.7))
    records = [bird(f"h{i}", 300, collected=int(i < 5)) for i in range(10)]
    report = agent.review_day(records)
    assert all(b["flags"] == [] for b in report["birds"])
    assert report["summary"]["unexplained_shortfall"] == 2.0
    assert report["actions"][0].startswith("Flock collected 5 eggs against 7.0 expected")


def test_quiet_day_needs_no_action(agent):
    report = agent.review_day([bird("a", 300, collected=1), bird("b", 450, collected=1)])
    assert report["actions"] == ["No action needed - the flock is laying as expected."]


def test_totals_left_blank_when_a_bird_is_unrecorded(agent):
    report = agent.review_day([bird("a", 300, collected=1), bird("b", 450)])
    assert report["summary"]["eggs_collected"] is None
    assert report["summary"]["shortfall"] is None


def test_age_is_required(agent):
    with pytest.raises(ValueError, match="Age"):
        agent.expected_eggs([{"GallusID": "x"}])


def test_api_review(agent):
    api.app.dependency_overrides[api.get_agent] = lambda: agent
    try:
        client = TestClient(api.app)
        response = client.post("/flock/review", json=[bird("a", 400, 1), bird("b", 985, 0)])
        assert response.status_code == 200
        assert flags(response.json()) == {"a": [], "b": ["not_expected_to_lay"]}

        response = client.post("/predict", json=[{"GallusID": "a", "Age": 400}])
        assert response.json()["predictions"][0]["expected_eggs"] > 0.9

        assert client.post("/flock/review", json=[{"GallusID": "a"}]).status_code == 422
    finally:
        api.app.dependency_overrides.clear()


def test_web_app_and_its_endpoints(agent):
    api.app.dependency_overrides[api.get_bundle] = lambda: {
        "pipeline": agent.pipeline,
        "metrics": {"r2": 0.99},
        "n_birds": 200,
        "sklearn_version": "test",
    }
    try:
        client = TestClient(api.app)
        page = client.get("/")
        assert page.status_code == 200 and "FlockWise" in page.text
        assert client.get("/static/app.js").status_code == 200

        info = client.get("/model").json()
        assert info["model"] == "RandomForestRegressor" and info["n_birds"] == 200

        sample = client.get("/sample-flock").json()
        assert len(sample) >= 1 and all("Age" in bird for bird in sample)
        # the web app sends the sample flock straight to the review endpoint
        assert client.post("/flock/review", json=sample).status_code == 200
    finally:
        api.app.dependency_overrides.clear()
