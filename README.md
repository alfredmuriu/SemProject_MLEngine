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
