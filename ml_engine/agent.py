"""FlockAgent - reviews a flock's weekly records and recommends what to do.

In agent terms (Russell & Norvig) this is a model-based reflex agent:
  percept      - a flock's weekly records so far: hens alive, eggs collected,
                 feed used and deaths, one record per week of age
  world model  - the trained forecasters, which say what laying rate the flock
                 is heading for 1, 4 and 8 weeks from now, plus the breed's
                 standard laying curve
  rules        - condition-action rules that compare this week and the
                 forecasts with the standard and turn the gaps into actions
                 for the ERP's Production Tracking and Feed Management modules

    python -m ml_engine.agent examples/sample_flock.json
"""
import argparse
import json

from . import model
from .data import MIN_WEEKS, derive, forecast_row
from .train import DEFAULT_MODEL_PATH


def _r(value, digits=1):
    return None if value is None or value != value else round(float(value), digits)  # NaN -> None


class FlockAgent:
    def __init__(
        self,
        bundle,
        tolerance=5.0,
        mortality_alert_pct=0.5,
        feed_alert_kg_per_dozen=2.0,
        warning_horizon=4,
    ):
        self.bundle = bundle
        self.curve = bundle["standard_curve"]
        # laying this many points under the standard counts as a problem;
        # smaller gaps are normal week-to-week noise (the 1-week forecast is
        # off by about 2.5 points on average)
        self.tolerance = tolerance
        # weekly deaths + culls, % of the flock; the dataset's median is 0.14%
        self.mortality_alert_pct = mortality_alert_pct
        # feed per dozen eggs, kg; the dataset's median is 1.61 kg
        self.feed_alert_kg_per_dozen = feed_alert_kg_per_dozen
        # the forecast the early warning is based on
        self.warning_horizon = warning_horizon

    @classmethod
    def from_file(cls, path=DEFAULT_MODEL_PATH, **settings):
        return cls(model.load(path), **settings)

    def forecast(self, weeks):
        """Laying-rate forecasts from the latest week, one per horizon.

        A horizon is left out when its target age is outside the ages the
        model was trained on (19-70 weeks).
        """
        weeks = list(weeks)
        out = []
        for horizon, entry in sorted(self.bundle["horizons"].items()):
            row = forecast_row(weeks, horizon, self.curve)
            if row is None:
                continue
            predicted = float(entry["model"].predict(row)[0])
            # a laying rate can't go below 0; it can pass 100 slightly, because
            # eggs are counted per hen alive at the end of the week
            predicted = max(predicted, 0.0)
            spread = entry["results"][entry["model_name"]]["p80_error"]
            standard = float(row["target_standard"].iloc[0])
            out.append(
                {
                    "horizon_weeks": horizon,
                    "age_weeks": int(row["target_age_weeks"].iloc[0]),
                    "lay_rate": _r(predicted),
                    "low": _r(max(predicted - spread, 0.0)),
                    "high": _r(predicted + spread),
                    "standard": _r(standard),
                    "gap": _r(predicted - standard),
                }
            )
        return out

    def review(self, weeks, flock_id=None):
        """Perceive the records, reason with the forecasts, decide actions."""
        weeks = list(weeks)
        if len(weeks) < MIN_WEEKS:
            raise ValueError(f"A review needs at least {MIN_WEEKS} consecutive weeks of records.")
        derived = derive(weeks, self.curve)
        now = derived.iloc[-1]
        forecasts = self.forecast(weeks)
        by_horizon = {f["horizon_weeks"]: f for f in forecasts}

        latest = {
            "age_weeks": int(now["age_weeks"]),
            "hens": int(now["hens"]),
            "eggs": int(now["eggs"]),
            "deaths": int(now["deaths"]),
            "lay_rate": _r(now["lay_rate"]),
            "standard": _r(now["standard"]),
            "gap": _r(now["gap"]),
            "feed_g_per_hen": _r(now["feed_g"]),
            "feed_kg_per_dozen": _r(now["feed_kg_per_dozen"], 2),
            "mortality_pct": _r(now["mortality_pct"], 2),
            "cum_mortality_pct": _r(now["cum_mortality_pct"], 2),
        }
        next_week = by_horizon.get(1)
        expected_eggs_next_week = (
            None if next_week is None else int(round(next_week["lay_rate"] / 100 * 7 * latest["hens"]))
        )

        flags = self._flags(latest, by_horizon.get(self.warning_horizon))
        return {
            "flock_id": flock_id,
            "weeks_recorded": len(weeks),
            "latest": latest,
            "forecasts": forecasts,
            "expected_eggs_next_week": expected_eggs_next_week,
            "flags": flags,
            "actions": self._actions(flags, latest, by_horizon.get(self.warning_horizon)),
            "history": [
                {"age_weeks": int(r.age_weeks), "lay_rate": _r(r.lay_rate), "standard": _r(r.standard)}
                for r in derived.itertuples()
            ],
        }

    def _flags(self, latest, ahead):
        flags = []
        behind_now = latest["gap"] is not None and latest["gap"] < -self.tolerance
        behind_later = ahead is not None and ahead["gap"] < -self.tolerance
        if behind_now:
            flags.append("below_standard")
            if ahead is not None and not behind_later:
                flags.append("recovering")
        elif behind_later:
            # on track today, heading below standard: the early warning
            flags.append("falling_behind")
        if latest["mortality_pct"] is not None and latest["mortality_pct"] > self.mortality_alert_pct:
            flags.append("high_mortality")
        # feed per egg only means something once the flock is in full lay
        if (
            latest["feed_kg_per_dozen"] is not None
            and latest["lay_rate"] >= 50
            and latest["feed_kg_per_dozen"] > self.feed_alert_kg_per_dozen
        ):
            flags.append("poor_feed_efficiency")
        return flags

    def _actions(self, flags, latest, ahead):
        actions = []
        if "below_standard" in flags:
            text = (
                f"Laying is {abs(latest['gap']):.1f} points below the breed standard this week "
                f"({latest['lay_rate']:.1f}% against {latest['standard']:.1f}%). Check feed and water "
                "supply, lighting hours, and the birds for signs of disease or stress."
            )
            if "recovering" in flags:
                text += (
                    f" The model expects it to recover to {ahead['lay_rate']:.1f}% in "
                    f"{ahead['horizon_weeks']} weeks, close to the standard."
                )
            elif ahead is not None:
                text += (
                    f" The model expects it to stay behind: {ahead['lay_rate']:.1f}% in "
                    f"{ahead['horizon_weeks']} weeks against a standard of {ahead['standard']:.1f}%."
                )
            actions.append(text)
        if "falling_behind" in flags:
            actions.append(
                f"On track now, but the model forecasts {ahead['lay_rate']:.1f}% in "
                f"{ahead['horizon_weeks']} weeks, {abs(ahead['gap']):.1f} points below the standard "
                f"of {ahead['standard']:.1f}%. Act early: review the feed ration, lighting programme "
                "and house temperature before production drops."
            )
        if "high_mortality" in flags:
            actions.append(
                f"{latest['deaths']} birds died or were culled this week ({latest['mortality_pct']:.2f}% "
                f"of the flock), above the {self.mortality_alert_pct}% alert level. Inspect the flock, "
                "remove sick birds and consider a vet visit."
            )
        if "poor_feed_efficiency" in flags:
            actions.append(
                f"Feed per dozen eggs was {latest['feed_kg_per_dozen']:.2f} kg, above "
                f"{self.feed_alert_kg_per_dozen} kg. Check feeders for wastage and the ration's quality."
            )
        if not actions:
            text = f"No action needed - laying at {latest['lay_rate']:.1f}%"
            if latest["standard"] is not None:
                text += f" against a standard of {latest['standard']:.1f}%"
            if ahead is not None:
                text += f", forecast {ahead['lay_rate']:.1f}% in {ahead['horizon_weeks']} weeks"
            actions.append(text + ".")
        return actions


def main(argv=None):
    parser = argparse.ArgumentParser(description="Review a flock's weekly records.")
    parser.add_argument("records", help="JSON file: {flock_id, weeks: [...]}")
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH)
    args = parser.parse_args(argv)

    with open(args.records, encoding="utf-8") as f:
        flock = json.load(f)
    report = FlockAgent.from_file(args.model).review(flock["weeks"], flock.get("flock_id"))

    print(json.dumps({"latest": report["latest"], "forecasts": report["forecasts"]}, indent=2))
    print(f"\nExpected eggs next week: {report['expected_eggs_next_week']}")
    print("\nActions:")
    for action in report["actions"]:
        print(f"  - {action}")


if __name__ == "__main__":
    main()
