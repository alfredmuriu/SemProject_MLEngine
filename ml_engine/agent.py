"""FlockAgent - reviews a day of flock records and recommends what to do.

In agent terms (Russell & Norvig) this is a model-based reflex agent:
  percept      - one day's records for a flock: each bird's attributes, the
                 feed it was given and, optionally, the eggs collected from it
  world model  - the trained EggsPerDay regressor, which says what each bird
                 *should* produce, now and a few weeks ahead
  rules        - condition-action rules that compare expected with actual and
                 turn the gaps into actions for the ERP's Production Tracking
                 and Feed Management modules

    python -m ml_engine.agent examples/flock_today.json
"""
import argparse
import json

import numpy as np

from . import model
from .data import to_feature_frame
from .train import DEFAULT_MODEL_PATH


class FlockAgent:
    def __init__(self, pipeline, laying_threshold=0.5, missed_lay_threshold=0.8, lookahead_days=30):
        self.pipeline = pipeline
        # expected eggs below this -> the bird is treated as not laying
        self.laying_threshold = laying_threshold
        # a bird only counts as having "missed" a lay if the model was fairly
        # sure it would lay, so borderline birds don't raise false alarms
        self.missed_lay_threshold = missed_lay_threshold
        self.lookahead_days = lookahead_days

    @classmethod
    def from_file(cls, path=DEFAULT_MODEL_PATH, **settings):
        return cls(model.load(path)["pipeline"], **settings)

    def expected_eggs(self, records):
        """Expected eggs per bird for the day, one value per record."""
        X = to_feature_frame(records)
        if X["Age"].isna().any():
            raise ValueError("Every bird needs an Age - it is the model's main input.")
        # A hen lays at most one egg a day, so anything outside 0-1 is the
        # regressor overshooting rather than a real prediction.
        return np.clip(self.pipeline.predict(X), 0.0, 1.0)

    def review_day(self, records):
        """Perceive one day's records, reason with the model, decide actions."""
        records = list(records)
        if not records:
            raise ValueError("No birds in the flock records.")

        expected_now = self.expected_eggs(records)
        # Same birds, aged forward: lets the agent warn about birds that are
        # still laying today but are about to stop.
        aged = [{**r, "Age": float(r["Age"]) + self.lookahead_days} for r in records]
        expected_later = self.expected_eggs(aged)

        birds = []
        for record, now, later in zip(records, expected_now, expected_later):
            collected = record.get("EggsCollected")
            flags = []
            if now < self.laying_threshold:
                flags.append("not_expected_to_lay")
            elif later < self.laying_threshold:
                flags.append("end_of_lay_soon")
            if collected is not None and collected == 0 and now >= self.missed_lay_threshold:
                flags.append("missed_lay")
            birds.append(
                {
                    "GallusID": record.get("GallusID"),
                    "expected_eggs": round(float(now), 3),
                    "expected_eggs_later": round(float(later), 3),
                    "eggs_collected": collected,
                    "AmountOfFeed": record.get("AmountOfFeed"),
                    "flags": flags,
                }
            )

        summary = self._summarise(birds)
        return {
            "lookahead_days": self.lookahead_days,
            "summary": summary,
            "actions": self._decide_actions(birds, summary),
            "birds": birds,
        }

    @staticmethod
    def _summarise(birds):
        def total(key, subset=birds):
            values = [b[key] for b in subset]
            # only report a total if every bird has the value, otherwise the
            # number would quietly undercount
            return sum(values) if values and all(v is not None for v in values) else None

        expected = sum(b["expected_eggs"] for b in birds)
        collected = total("eggs_collected")
        feed = total("AmountOfFeed")
        non_layers = [b for b in birds if "not_expected_to_lay" in b["flags"]]
        shortfall = unexplained = None
        if collected is not None:
            shortfall = expected - collected
            # Eggs the missed_lay birds should have laid are already accounted
            # for by their own flag. Whatever is left points at a flock-wide cause.
            unexplained = shortfall - sum(b["expected_eggs"] for b in birds if "missed_lay" in b["flags"])
        return {
            "birds": len(birds),
            "expected_eggs": round(expected, 1),
            "eggs_collected": collected,
            "shortfall": None if shortfall is None else round(shortfall, 1),
            # + 0.0 turns a rounded -0.0 into a plain 0.0
            "unexplained_shortfall": None if unexplained is None else round(unexplained, 1) + 0.0,
            # AmountOfFeed is assumed to be grams per bird per day - the
            # dataset does not state units, but 100-129 matches layer rations
            "feed_g": feed,
            "feed_g_per_egg": None if not feed or not collected else round(feed / collected, 1),
            "feed_g_on_non_layers": total("AmountOfFeed", non_layers) if non_layers else 0,
        }

    def _decide_actions(self, birds, summary):
        def ids(flag):
            return [b["GallusID"] for b in birds if flag in b["flags"]]

        actions = []
        missed = ids("missed_lay")
        if missed:
            actions.append(
                f"Check {', '.join(missed)} for illness, stress or broodiness - "
                "the model expected eggs from them today but none were collected."
            )
        non_layers = ids("not_expected_to_lay")
        if non_layers:
            one = len(non_layers) == 1
            feed = summary["feed_g_on_non_layers"]
            feed_note = ""
            if feed:
                feed_note = f" {'It eats' if one else 'They eat'} {feed:g} g of feed a day" + (
                    "." if one else " between them."
                )
            actions.append(
                f"{', '.join(non_layers)} {'is' if one else 'are'} not expected to lay at "
                f"{'its' if one else 'their'} age.{feed_note} "
                f"Consider culling {'it' if one else 'them'} or moving "
                f"{'it' if one else 'them'} off layer feed."
            )
        ending = ids("end_of_lay_soon")
        if ending:
            actions.append(
                f"{', '.join(ending)} {'is' if len(ending) == 1 else 'are'} expected to stop "
                f"laying within {self.lookahead_days} days - plan replacement birds."
            )
        unexplained = summary["unexplained_shortfall"]
        if unexplained is not None and unexplained >= max(1.0, 0.1 * summary["expected_eggs"]):
            actions.append(
                f"Flock collected {summary['eggs_collected']} eggs against "
                f"{summary['expected_eggs']} expected, and no single bird explains the gap - "
                "check feed, water, lighting and egg collection across the house."
            )
        return actions or ["No action needed - the flock is laying as expected."]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Review a day of flock records.")
    parser.add_argument("records", help="JSON file with a list of bird records")
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH)
    args = parser.parse_args(argv)

    with open(args.records, encoding="utf-8") as f:
        records = json.load(f)
    report = FlockAgent.from_file(args.model).review_day(records)

    print(json.dumps(report["summary"], indent=2))
    print("\nActions:")
    for action in report["actions"]:
        print(f"  - {action}")


if __name__ == "__main__":
    main()
