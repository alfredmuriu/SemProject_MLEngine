"""Train the EggsPerDay model and save it for the agent and API.

    python -m ml_engine.train
    python -m ml_engine.train --csv path/to/GallusGallusDomesticus.csv
"""
import argparse
import os

from . import model
from .data import FEATURES, TARGET, load_raw, one_row_per_bird, to_feature_frame

DEFAULT_MODEL_PATH = os.path.join("models", "egg_model.joblib")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--csv", help="local copy of the dataset (downloads from Kaggle if omitted)")
    parser.add_argument("--out", default=DEFAULT_MODEL_PATH)
    args = parser.parse_args(argv)

    birds = one_row_per_bird(load_raw(args.csv))
    X, y = to_feature_frame(birds[FEATURES]), birds[TARGET]
    print(f"{len(birds)} birds, {int((y == 0).sum())} of them laying 0 eggs")

    pipeline = model.build_pipeline()
    metrics = model.evaluate(pipeline, X, y)
    print(
        f"CV  MAE {metrics['mae']:.4f}  RMSE {metrics['rmse']:.4f}  "
        f"R2 {metrics['r2']:.3f} (+/- {metrics['r2_std']:.3f})"
    )

    # CV only estimates how good the model is. The model that gets saved is
    # refitted on every bird, since there are too few to hold any back.
    pipeline.fit(X, y)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    model.save(pipeline, args.out, metrics=metrics, n_birds=len(birds))
    print(f"Saved model to {args.out}")


if __name__ == "__main__":
    main()
