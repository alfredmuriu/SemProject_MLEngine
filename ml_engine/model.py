"""Forecasting models for a flock's laying rate: candidates, baselines,
leave-one-flock-out evaluation, and saving/loading."""
import joblib
import numpy as np
import sklearn
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .data import FEATURES

CANDIDATES = {
    "Ridge regression": lambda: make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
    "Random forest": lambda: RandomForestRegressor(n_estimators=400, min_samples_leaf=3, random_state=42),
    "Gradient boosting": lambda: GradientBoostingRegressor(
        n_estimators=300, max_depth=3, learning_rate=0.05, random_state=42
    ),
}

# Simple rules a farmer could use without any model. A model is only worth
# having if it beats all of them on flocks it has never seen.
BASELINES = {
    "Same as this week": lambda t: t["lay_rate"],
    "Breed standard": lambda t: t["target_standard"],
    "Standard + this week's gap": lambda t: t["target_standard"] + t["gap"],
}


def score(y, predicted):
    errors = np.abs(np.asarray(y) - np.asarray(predicted))
    return {
        "mae": float(mean_absolute_error(y, predicted)),
        "r2": float(r2_score(y, predicted)),
        # 80% of forecasts were within this many points - shown as the
        # forecast's range in the app
        "p80_error": float(np.quantile(errors, 0.8)),
    }


def leave_one_flock_out(make_model, table):
    """Predictions for every row, each made by a model that never saw that
    row's flock. With 9 flocks that is 9 fits.

    Splitting by flock rather than by row matters: weeks of the same flock are
    strongly alike, so a random split would let the model peek at the answer.
    """
    X, y, groups = table[FEATURES], table["target"], table["flock_id"]
    predicted = np.zeros(len(table))
    for train, test in LeaveOneGroupOut().split(X, y, groups):
        model = make_model().fit(X.iloc[train], y.iloc[train])
        predicted[test] = model.predict(X.iloc[test])
    return predicted


def compare(table):
    """Score every baseline and candidate on held-out flocks."""
    y = table["target"]
    results = {name: score(y, rule(table)) for name, rule in BASELINES.items()}
    predictions = {}
    for name, make_model in CANDIDATES.items():
        predictions[name] = leave_one_flock_out(make_model, table)
        results[name] = score(y, predictions[name])
    return results, predictions


# The engine uses a random forest for every horizon. It scores best at 4 and
# 8 weeks ahead and is within 0.03 points of gradient boosting at 1 week, so
# one model type keeps the engine simple. The other candidates are still
# scored, as the evidence for that choice.
CHOSEN = "Random forest"


def save(bundle, path):
    """Save the fitted models with how they were trained and scored.

    The scikit-learn version is stored because a pickled model is only safe
    to load with the version that saved it.
    """
    joblib.dump({**bundle, "sklearn_version": sklearn.__version__}, path)


def load(path):
    bundle = joblib.load(path)
    if bundle.get("sklearn_version") != sklearn.__version__:
        print(
            f"Warning: model saved with scikit-learn {bundle.get('sklearn_version')}, "
            f"running {sklearn.__version__}. Retrain if forecasts look wrong."
        )
    return bundle
