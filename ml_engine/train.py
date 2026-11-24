"""Train one laying-rate forecaster per horizon and save them for the agent and API.

    python -m ml_engine.train
    python -m ml_engine.train --data path/to/DATA_Repository.txt
"""
import argparse
import os

from . import model
from .data import HORIZONS, load_raw, standard_curve, to_flocks, training_table

DEFAULT_MODEL_PATH = os.path.join("models", "flock_forecaster.joblib")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", help="the dataset file (uses data/ or downloads it if omitted)")
    parser.add_argument("--out", default=DEFAULT_MODEL_PATH)
    args = parser.parse_args(argv)

    raw = load_raw(args.data)
    flocks = to_flocks(raw)
    curve = standard_curve(raw)
    print(f"{len(flocks)} flocks, {sum(len(w) for w in flocks.values())} flock-weeks")

    horizons = {}
    for horizon in HORIZONS:
        table = training_table(flocks, horizon, curve)
        results, _ = model.compare(table)
        best = model.choose(results)
        print(f"\n{horizon} week(s) ahead - {len(table)} forecasts, scored leaving one flock out:")
        for name, r in sorted(results.items(), key=lambda kv: kv[1]["mae"]):
            mark = "  <- chosen" if name == best else ""
            print(f"  {name:28s} MAE {r['mae']:5.2f} pts  R2 {r['r2']:6.3f}{mark}")
        # The held-out scores estimate how good the model is on a new flock.
        # The model that gets saved is refitted on every flock.
        fitted = model.CANDIDATES[best]().fit(table[model.FEATURES], table["target"])
        horizons[horizon] = {"model": fitted, "model_name": best, "results": results, "n_rows": len(table)}

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    model.save(
        {
            "horizons": horizons,
            "standard_curve": curve,
            "features": model.FEATURES,
            "n_flocks": len(flocks),
            "n_weeks": sum(len(w) for w in flocks.values()),
        },
        args.out,
    )
    print(f"\nSaved {args.out}")


if __name__ == "__main__":
    main()
