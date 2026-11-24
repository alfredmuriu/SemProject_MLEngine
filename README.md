# SemProject_MLEngine

ICS 3202 Artificial Intelligence semester project: the ML engine for a poultry farm
management ERP. It **forecasts a laying flock's laying rate 1, 4 and 8 weeks ahead**
and warns the farmer early when the flock is heading below the breed standard.

## The data

[Historical performance of Lohmann Brown-Classic laying hens in Colombia](https://data.mendeley.com/datasets/t2gzbht99m)
(Cabezas-García, Rodríguez-Aguilar & Betancourt López, 2024, Mendeley Data,
doi:10.17632/t2gzbht99m.1, **CC BY 4.0**). It has real weekly records of 9 commercial flocks
of about 1,500 hens each, from 19 to 71 weeks of age, 2003–2015. That makes 468 flock-weeks.
A copy is in [data/](data/), so nothing has to be downloaded.

The engine uses only what a farm records each week: the flock's **age**, **hens alive**,
**eggs collected**, **feed used** (kg) and **deaths** (dead + culled). Every rate is worked out
from those.

### Why the dataset changed

The first version used the Kaggle *Egg Producing Chickens* dataset. Its target turned out to
be decided by one rule: every hen older than about 950 days laid 0 eggs, and every younger
hen laid 1. A model could only rediscover that rule. Three replacements were downloaded and
tested before choosing this one (see the table in `Lohmann_Exploration.ipynb`). The old version
is kept in [archive/v1-egg-producing-chickens/](archive/v1-egg-producing-chickens/).

## Deliverable 1: `Lohmann_Exploration.ipynb`

This notebook covers dataset discovery and the exploration questions from the brief (rows and
columns, datatypes, missing values, the `df_sample` slice). It also covers:
- which columns are raw records and which are calculated from them;
- every flock's laying curve against the breed standard.

## Deliverable 2: `LayingRate_Model.ipynb`

This notebook builds the inputs, compares three models with three simple rules a farmer could
use, checks that the model really learned, and saves the chosen models. Every score comes from
**flocks the model never saw**: it trains on 8 flocks and tests on the 9th, repeated for each
flock.

Mean absolute error in laying-rate points on unseen flocks (lower is better):

| Method | 1 week ahead | 4 weeks ahead | 8 weeks ahead |
|---|---|---|---|
| **Chosen model** | **2.47** (gradient boosting) | **2.83** (random forest) | **2.91** (random forest) |
| Same as this week (rule) | 3.50 | 6.89 | 8.38 |
| Breed standard (rule) | 5.36 | 3.44 | 3.14 |
| Standard + this week's gap (rule) | 3.06 | 5.73 | 6.66 |

What the notebook found:
- **The best model beats every rule at every horizon.** The margin is about 18–19% at 1 and 4
  weeks, and under 10% at 8 weeks, where the forecast leans on the breed curve.
- **The model learned something real.** Its error on an unseen flock falls steadily as it is
  trained on more flocks. It needs about 5 flocks to beat the breed guide.
- **It weighs its evidence differently at each horizon.** For next week it relies on the
  flock's recent laying. For two months out it shifts to age and the breed curve.
- **A random split would flatter it** (4-week MAE 2.62 against an honest 2.83), which is why
  every score is by flock.
- **The start of lay is the hardest part.** Errors double while flocks ramp up to their peak.
- **Limitations.** All the data comes from one farm, one breed and one country, and there are
  only 9 flocks. The records also can't predict sudden dips from disease or stress. The engine
  should be retrained on local Kenyan records before anyone relies on it.

## The ML engine (`ml_engine/`)

| File | What it does |
|---|---|
| `data.py` | loads the dataset, turns it into weekly records per flock, builds the inputs (only from the past) |
| `model.py` | the candidate models, the baseline rules, leave-one-flock-out scoring, saving/loading |
| `train.py` | scores every candidate, picks the best per horizon, saves `models/flock_forecaster.joblib` |
| `agent.py` | `FlockAgent`: reviews a flock's weekly records and recommends actions |
| `api.py` | FastAPI service the ERP calls; it also serves the web app |
| `web/` | FlockWise, the web front end (plain HTML/CSS/JS, no build step) |

`FlockAgent` is a model-based reflex agent. It asks the forecasters where the flock's laying
rate is heading, then applies four rules:
- flag a flock more than 5 points **below the breed standard**, and say whether it is expected
  to recover;
- give an **early warning** when a flock on track today is forecast to fall behind within
  4 weeks;
- flag weekly **mortality** above 0.5%;
- flag **feed per dozen eggs** above 2 kg.

It also gives the number of eggs to expect next week.

### How to run it

```
python -m venv .venv && .venv\Scripts\activate      # Windows (source .venv/bin/activate elsewhere)
pip install -r requirements.txt
python -m ml_engine.train                            # score the models, train and save them
python -m ml_engine.agent examples/sample_flock.json # review the sample flock
uvicorn ml_engine.api:app --reload                   # web app at http://127.0.0.1:8000, API docs at /docs
pytest                                               # tests (offline, no dataset needed)
```

API endpoints:
- `POST /flock/review`: the agent's full report.
- `POST /forecast`: forecasts only.
- `GET /model`: how the models were trained and scored.
- `GET /standard-curve`
- `GET /sample-flock`
- `GET /health`

Both POST endpoints take `{"flock_id": "...", "weeks": [...]}`. That's at least 3 consecutive
weeks, oldest first, each with `age_weeks`, `hens`, `eggs`, `feed_kg` and optionally `deaths`.

### The web app (FlockWise)

Running the API also serves FlockWise at `/`, in the same design language as the ERPs:
- **Flock review:** enter the weekly records (or load the sample flock) and run the agent. You
  get this week against the standard, forecasts with a likely range, a chart, the expected eggs
  next week and the recommended actions.
- **The model:** every method's error on unseen flocks, and what the scores do and don't mean.

Open `http://127.0.0.1:8000/?demo` to load the sample flock and run the review straight away.
The sample is real: flock G2-F2's first 16 weeks. That flock was in the training data, so the
app notes that its forecasts look better than they would for a new flock. To open it on a
phone on the same Wi-Fi, start the server with `--host 0.0.0.0`, then go to the laptop's IP
address on port 8000.
