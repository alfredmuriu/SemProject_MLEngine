"""Loading the Egg Producing Chickens dataset and shaping it for training."""
import glob
import os

import pandas as pd

DATASET = "phuzoman/egg-producing-chickens"
TARGET = "EggsPerDay"

NUMERIC_FEATURES = ["Age", "GallusWeight", "GallusEggWeight", "AmountOfFeed", "SunLightExposure"]
CATEGORICAL_FEATURES = [
    "GallusBreed",
    "GallusEggColor",
    "GallusCombType",
    "GallusLegShanksColor",
    "GallusBeakColor",
    "GallusPlumage",
]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

# Left out on purpose:
#   GallusID            - an identifier, not something that causes egg laying
#   Day                 - just the row's position in each bird's record
#   GallusClass         - one value only, and it is missing for exactly the
#                         Ameraucana birds, so it repeats GallusBreed
#   GallusEarLobesColor - missing for 91.5% of rows


def load_raw(csv_path=None):
    """Read the CSV, downloading it from Kaggle first if no path is given.

    kagglehub can fetch public datasets without an API token, so this works
    both locally and in Colab.
    """
    if csv_path is None:
        import kagglehub

        folder = kagglehub.dataset_download(DATASET)
        csv_path = glob.glob(os.path.join(folder, "*.csv"))[0]
    return pd.read_csv(csv_path)


def one_row_per_bird(df):
    """Collapse the repeated daily rows into one row per bird.

    In this dataset every bird's row is copied once per Day with identical
    values, so the 1,000 rows are really 190 birds. Training on the copies
    would let the same bird appear in both the train and test folds.
    """
    birds = df.drop(columns="Day").drop_duplicates()
    if birds["GallusID"].duplicated().any():
        # Real farm logs will change from day to day. At that point collapsing
        # would throw information away, and the split should be grouped by
        # GallusID instead.
        raise ValueError(
            "Some birds have rows that differ between days - "
            "use a split grouped by GallusID instead of collapsing."
        )
    return birds.reset_index(drop=True)


def to_feature_frame(records):
    """Turn a DataFrame or a list of dicts into the model's input columns.

    Columns the caller did not supply are added as empty, so the pipeline's
    imputers can fill them. Categoricals are forced to object dtype because an
    all-empty column would otherwise be read as numeric and the "Unknown"
    fill value would be rejected.
    """
    frame = pd.DataFrame(records).reindex(columns=FEATURES)
    frame[CATEGORICAL_FEATURES] = frame[CATEGORICAL_FEATURES].astype(object)
    frame[NUMERIC_FEATURES] = frame[NUMERIC_FEATURES].apply(pd.to_numeric)
    return frame
