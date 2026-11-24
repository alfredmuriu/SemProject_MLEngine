"""Loading the Lohmann Brown flock records and turning them into model inputs.

Dataset: Cabezas-Garcia, Rodriguez-Aguilar & Betancourt Lopez (2024),
"Evaluation of the historical performance of Lohmann Brown-Classic laying hens
maintained on a conventional cage system in Colombia", Mendeley Data,
doi:10.17632/t2gzbht99m.1, licence CC BY 4.0.

Nine flocks of about 1,500 hens, each recorded weekly from 19 to 71 weeks of
age (468 flock-weeks). A copy ships in data/ so nothing has to be downloaded.

The engine works from what a farm records each week for a flock:

    age_weeks  age of the flock that week
    hens       hens alive at the end of the week
    eggs       eggs collected during the week
    feed_kg    feed used during the week, kg
    deaths     birds that died or were culled (optional - worked out from the
               drop in `hens` when left out)

Everything the model sees is derived from those five numbers by `derive`, for
training and for live forecasts alike, so the two can't drift apart.
"""
import os
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

DATA_URL = (
    "https://data.mendeley.com/public-files/datasets/t2gzbht99m/files/"
    "5dfb5617-19d0-4307-b969-3ac722b1c12b/file_downloaded"
)
LOCAL_COPY = Path(__file__).parent.parent / "data" / "lohmann_brown_flocks.txt"

# How far ahead the engine forecasts, in weeks. One model is trained per horizon.
HORIZONS = (1, 4, 8)

# Weeks of history a forecast needs: this week and the two before it.
MIN_WEEKS = 3

FEATURES = [
    "age_weeks",
    "lay_rate",
    "lay_rate_1",  # one week earlier
    "lay_rate_2",  # two weeks earlier
    "trend",  # lay_rate - lay_rate_2
    "feed_g",
    "feed_g_1",
    "mortality_pct",
    "cum_mortality_pct",
    "standard",
    "gap",  # lay_rate - standard
    "target_age_weeks",
    "target_standard",
]


def load_raw(path=None):
    """Read the dataset as published (tab-separated), from data/ or the web."""
    if path is None:
        path = LOCAL_COPY
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(DATA_URL, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request) as response:
                path.write_bytes(response.read())
    raw = pd.read_csv(path, sep="\t")
    # the file ends with one empty line, which pandas reads as a row of NaNs
    return raw.dropna(how="all").reset_index(drop=True)


def to_flocks(raw):
    """Turn the published table into one list of weekly records per flock.

    Only the columns a farm would actually record are kept. The rest of the
    file (laying rate, eggs per hen, feed conversion...) is arithmetic on
    those columns, so using it as input would leak the answer.
    """
    raw = raw.copy()
    raw["flock_id"] = (
        "G" + raw["Generation"].astype(int).astype(str) + "-F" + raw["Flock"].astype(int).astype(str)
    )
    flocks = {}
    for flock_id, rows in raw.sort_values("WeekOld").groupby("flock_id", sort=True):
        housed = int(rows["HousedHens"].iloc[0])
        previous = housed
        weeks = []
        for row in rows.itertuples():
            hens = int(row.BirdsBalance)
            weeks.append(
                {
                    "age_weeks": int(row.WeekOld),
                    "hens": hens,
                    "eggs": int(row.NumberEggsPerWeek),
                    "feed_kg": float(row.FeedPerWeek),
                    "deaths": previous - hens,
                }
            )
            previous = hens
        flocks[flock_id] = weeks
    return flocks


def standard_curve(raw):
    """The breed's target laying rate (% of hens laying per day) by week of age.

    The farm's breed guide was updated over the years (generation 1 used an
    older curve), so the latest one - generation 3's - is used everywhere.
    The weekly values are identical across that generation's flocks.
    """
    latest = raw[raw["Generation"] == raw["Generation"].max()]
    ideal = pd.to_numeric(latest["IdealLayingRateDay"], errors="coerce")
    curve = ideal.groupby(latest["WeekOld"].astype(int)).median().dropna()
    return {int(age): round(float(v), 2) for age, v in curve.items()}


def derive(weeks, curve):
    """Weekly records -> one row per week with the rates the model uses.

    Raises ValueError for records a forecast can't be built from: weeks out of
    order or missing, or counts that don't make sense.
    """
    if not weeks:
        raise ValueError("No weekly records.")
    frame = pd.DataFrame(weeks)
    missing = {"age_weeks", "hens", "eggs", "feed_kg"} - set(frame.columns)
    if missing:
        raise ValueError(f"Every week needs {', '.join(sorted(missing))}.")
    frame = frame.astype({"age_weeks": int})
    ages = frame["age_weeks"].to_numpy()
    if (np.diff(ages) != 1).any():
        raise ValueError("Weeks must be consecutive, one record per week of age, oldest first.")
    if (frame["hens"] <= 0).any():
        raise ValueError("Hens alive must be more than 0 every week.")
    if (frame[["eggs", "feed_kg"]] < 0).any().any():
        raise ValueError("Eggs and feed can't be negative.")

    if "deaths" not in frame or frame["deaths"].isna().all():
        frame["deaths"] = (frame["hens"].shift(1) - frame["hens"]).clip(lower=0).fillna(0)
    frame["deaths"] = frame["deaths"].fillna(0)

    days = 7 * frame["hens"]
    frame["lay_rate"] = 100 * frame["eggs"] / days
    frame["feed_g"] = 1000 * frame["feed_kg"] / days
    frame["mortality_pct"] = 100 * frame["deaths"] / (frame["hens"] + frame["deaths"])
    housed = frame["hens"].iloc[0] + frame["deaths"].iloc[0]
    frame["cum_mortality_pct"] = 100 * frame["deaths"].cumsum() / housed
    frame["feed_kg_per_dozen"] = frame["feed_kg"] / (frame["eggs"] / 12).replace(0, np.nan)
    frame["standard"] = frame["age_weeks"].map(curve)
    frame["gap"] = frame["lay_rate"] - frame["standard"]
    frame["lay_rate_1"] = frame["lay_rate"].shift(1)
    frame["lay_rate_2"] = frame["lay_rate"].shift(2)
    frame["trend"] = frame["lay_rate"] - frame["lay_rate_2"]
    frame["feed_g_1"] = frame["feed_g"].shift(1)
    return frame


def add_target(derived, horizon, curve):
    """Add the forecast target: the laying rate `horizon` weeks later."""
    frame = derived.copy()
    frame["target_age_weeks"] = frame["age_weeks"] + horizon
    frame["target_standard"] = frame["target_age_weeks"].map(curve)
    frame["target"] = frame["lay_rate"].shift(-horizon)
    return frame


def training_table(flocks, horizon, curve):
    """Every (flock, week) with enough history, its features and its target."""
    parts = []
    for flock_id, weeks in flocks.items():
        frame = add_target(derive(weeks, curve), horizon, curve)
        frame["flock_id"] = flock_id
        parts.append(frame)
    table = pd.concat(parts, ignore_index=True)
    # drop the first weeks (no history yet), the last weeks (no target yet)
    # and targets past the end of the breed curve
    return table.dropna(subset=FEATURES + ["target"]).reset_index(drop=True)


def forecast_row(weeks, horizon, curve):
    """Features for a forecast made from the latest week, or None if the
    forecast would fall outside the ages the model was trained on."""
    derived = derive(weeks, curve)
    if len(derived) < MIN_WEEKS:
        raise ValueError(f"A forecast needs at least {MIN_WEEKS} consecutive weeks of records.")
    row = add_target(derived, horizon, curve).iloc[[-1]]
    if row[FEATURES].isna().any(axis=None):
        return None
    return row[FEATURES]
