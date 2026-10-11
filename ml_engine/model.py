"""The EggsPerDay regression pipeline: encoding, model, evaluation, saving."""
import joblib
import numpy as np
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .data import CATEGORICAL_FEATURES, NUMERIC_FEATURES


def build_preprocessor():
    """Scale the numeric columns and one-hot encode the categorical ones.

    Missing numbers are filled with the column median, and missing categories
    become their own "Unknown" level. That matters for the ERP, because a farm
    will not always record leg colour or egg weight for every bird.
    handle_unknown="ignore" stops a breed or colour the model has never seen
    from crashing a prediction.
    """
    numeric = make_pipeline(SimpleImputer(strategy="median"), StandardScaler())
    categorical = make_pipeline(
        SimpleImputer(strategy="constant", fill_value="Unknown"),
        OneHotEncoder(handle_unknown="ignore"),
    )
    return ColumnTransformer(
        [("num", numeric, NUMERIC_FEATURES), ("cat", categorical, CATEGORICAL_FEATURES)]
    )


def build_pipeline(regressor=None):
    """Preprocessing plus a regressor (a random forest unless told otherwise)."""
    if regressor is None:
        regressor = RandomForestRegressor(n_estimators=300, min_samples_leaf=2, random_state=42)
    return Pipeline([("prep", build_preprocessor()), ("model", regressor)])


def evaluate(pipeline, X, y, n_splits=5, n_repeats=10, random_state=42):
    """Repeated stratified k-fold CV, returning the mean and std of each metric.

    Stratified, because only a handful of birds lay 0 eggs - a plain split can
    leave a test fold with none of them. Repeated, because with so few of
    those birds one split's score depends heavily on where they landed.
    """
    cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=random_state)
    scores = cross_validate(
        pipeline,
        X,
        y,
        cv=cv,
        scoring={"mae": "neg_mean_absolute_error", "rmse": "neg_root_mean_squared_error", "r2": "r2"},
    )
    result = {}
    for name, sign in (("mae", -1), ("rmse", -1), ("r2", 1)):
        values = sign * scores[f"test_{name}"]
        result[name] = float(np.mean(values))
        result[f"{name}_std"] = float(np.std(values))
    return result


def save(pipeline, path, metrics=None, n_birds=None):
    """Save the fitted pipeline together with how it was evaluated.

    The sklearn version is stored because a pickled model is only safe to
    load with the same version that saved it.
    """
    joblib.dump(
        {
            "pipeline": pipeline,
            "metrics": metrics or {},
            "n_birds": n_birds,
            "sklearn_version": sklearn.__version__,
        },
        path,
    )


def load(path):
    bundle = joblib.load(path)
    if bundle.get("sklearn_version") != sklearn.__version__:
        print(
            f"Warning: model saved with scikit-learn {bundle.get('sklearn_version')}, "
            f"running {sklearn.__version__}. Retrain if predictions look wrong."
        )
    return bundle
