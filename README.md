# SemProject_MLEngine

ICS 3202: Artificial Intelligence — Semester Project, ML Engine.

**Project:** An Integrated Enterprise Resource Planning System for Poultry Farm Management

## Deliverable 1 — Dataset Exploration

[`Egg_Producing_Chickens_Exploration.ipynb`](Egg_Producing_Chickens_Exploration.ipynb)

Dataset: [Egg Producing Chickens](https://www.kaggle.com/datasets/phuzoman/egg-producing-chickens)
(Kaggle, `phuzoman/egg-producing-chickens`) — 1,000 daily observations across chicken
breeds, recording physical attributes, feed intake, sunlight exposure, and eggs laid
per day.

**Expected output variable:** `EggsPerDay` — daily egg yield per bird, feeding the
ERP's Production Tracking and Feed Management modules.

The notebook covers dataset discovery across five candidate sources, the output
variable each would support, and the required exploration questions (a–d).

### Running it

Open the notebook in Google Colab. The first cell prompts for a `kaggle.json` API
token (Kaggle → Settings → Create New API Token) and downloads the dataset.
Run the cells in order, top to bottom.
