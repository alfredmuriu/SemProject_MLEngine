# SemProject_MLEngine

ICS 3202 Artificial Intelligence semester project - ML engine for a poultry farm
management ERP.

## Deliverable 1

`EggProducingChickens_Exploration.ipynb` has the dataset discovery part and the
exploration questions from the brief (rows/columns, datatypes, missing values,
and the df_sample slice).

Dataset used: [Egg Producing Chickens](https://www.kaggle.com/datasets/phuzoman/egg-producing-chickens)
on Kaggle (`phuzoman/egg-producing-chickens`). It's 1,000 daily records per bird -
feed intake, age, weight, breed, sunlight exposure, and eggs laid that day.

The output variable we're going after is `EggsPerDay`, since that's what the
ERP's production tracking and feed management modules need to predict.

### How to run it

Open it in Colab, drop in a `kaggle.json` (get one from Kaggle account settings)
when the first cell asks for it, then run the cells top to bottom.

## Deliverable 2

`EggsPerDay_Model.ipynb` encodes the categorical columns, trains and compares
regression models for `EggsPerDay`, and evaluates them. It runs in Colab
without a `kaggle.json` - `kagglehub` downloads the dataset directly.

What it found:

- The 1,000 rows are really **190 birds**, each copied 5 or 10 times (only
  `Day` changes), so everything is evaluated per bird to stop the same bird
  showing up in both train and test.
- `EggsPerDay` is only ever 0 or 1, and **age alone decides it**: every bird
  aged 961+ days lays 0, every younger bird lays 1. Tree models score
  R² ≈ 1.0 because they learn that cut-off; linear models can't (R² ≈ 0).
- So the scores prove the pipeline works end to end, not that egg laying is
  this predictable. The final model is a random forest (R² 0.995 in repeated
  stratified 5-fold CV), picked over gradient boosting because it gives
  in-between values near the cut-off instead of a hard 1 → 0 step.

### The ML engine (`ml_engine/`)

| File | What it does |
|---|---|
| `data.py` | downloads the dataset, collapses it to one row per bird, shapes input for the model |
| `model.py` | the encoding + random forest pipeline, cross-validation, saving/loading |
| `train.py` | trains and saves `models/egg_model.joblib` |
| `agent.py` | `FlockAgent` - reviews a day of flock records and recommends actions |
| `api.py` | FastAPI service the ERP calls - also serves the web app |
| `web/` | FlockWise, the web front end (plain HTML/CSS/JS, no build step) |

`FlockAgent` is a model-based reflex agent: it uses the trained model to work
out what each bird *should* have laid today and in 30 days' time, compares
that with what was collected, and flags birds that missed a lay, birds about
to stop laying, birds not expected to lay (and the feed they eat), and
flock-wide shortfalls no single bird explains.

### How to run it

```
pip install -r requirements.txt
python -m ml_engine.train                             # train + save the model
python -m ml_engine.agent examples/flock_today.json   # review a sample day
uvicorn ml_engine.api:app --reload                    # web app at http://127.0.0.1:8000, API docs at /docs
pytest                                                # tests (no dataset download needed)
```

API endpoints: `POST /predict` (expected eggs per bird), `POST /flock/review`
(the agent's full report), `GET /model` (how the model was trained and scored),
`GET /sample-flock`, `GET /health`. The POST endpoints take a list of bird
records - only `GallusID` and `Age` are required, plus `EggsCollected` for the
review.

### The web app (FlockWise)

Running the API also serves FlockWise at `/`. It uses the same design
language as the ERPs (SiteLedger, Benchmark, MillFlow) with its own brand
colour, and has three pages:

- **Flock review** - enter each bird's age, feed and eggs collected (or load
  the sample flock), run the agent, and get its actions, the flock totals and
  a bird-by-bird table of expected eggs today and in 30 days
- **Predict a bird** - a form for one bird; anything left blank is filled by
  the model
- **The model** - the cross-validation scores, a chart of expected eggs
  against age, and the caveats about what the scores mean

Open `http://127.0.0.1:8000/?demo` to load the sample flock and run the review
straight away, which is handy for a presentation. The page also works in a
phone's browser on the same Wi-Fi: start the server with `--host 0.0.0.0` and
open the laptop's IP address on port 8000.
