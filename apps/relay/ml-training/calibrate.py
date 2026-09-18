import pandas as pd
import joblib
from sklearn.calibration import CalibratedClassifierCV
import numpy as np

def calibrate_model():
    print("Loading datasets and model...")
    # Typically we'd use a separate validation set for calibration, 
    # but here we can just use CalibratedClassifierCV with cv='prefit' on the test set,
    # or just fit it on the train set using cv=5.
    df = pd.read_csv("apps/relay/ml-training/data/dataset.csv")
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    
    vectorizer = joblib.load("apps/relay/ml-training/vectorizer.pkl")
    base_model = joblib.load("apps/relay/ml-training/model_uncalibrated.pkl")
    
    X_train = vectorizer.transform(train_df['email_text'])
    y_train = train_df['label']
    
    print("Calibrating model using Platt scaling (sigmoid) with 5-fold CV...")
    # Wrap with CalibratedClassifierCV. Note: cv=5 will cross-validate on X_train to train calibrations.
    # To keep it simple and match exactly one set of coefficients, we can fit a single base model,
    # but CalibratedClassifierCV(cv=5) trains 5 models.
    # The requirement is a single set of coefficients + calibration.
    # So we MUST use cv="prefit" on a validation set!
    
    # Split train_df into sub-train and calibration
    sub_split_idx = int(len(train_df) * 0.8)
    sub_train = train_df.iloc[:sub_split_idx]
    sub_calib = train_df.iloc[sub_split_idx:]
    
    # Train base model on sub_train
    print("Retraining base model on sub-train to allow prefit calibration on sub-calib...")
    X_sub_train = vectorizer.transform(sub_train['email_text'])
    y_sub_train = sub_train['label']
    
    from sklearn.linear_model import LogisticRegression
    base_model = LogisticRegression(class_weight='balanced', max_iter=1000)
    base_model.fit(X_sub_train, y_sub_train)
    
    # Calibrate on sub_calib
    X_sub_calib = vectorizer.transform(sub_calib['email_text'])
    y_sub_calib = sub_calib['label']
    
    calibrated_model = CalibratedClassifierCV(estimator=base_model, method='sigmoid', cv='prefit')
    calibrated_model.fit(X_sub_calib, y_sub_calib)
    
    print("Calibration complete. Saving calibrated model...")
    joblib.dump(calibrated_model, "apps/relay/ml-training/model_calibrated.pkl")
    joblib.dump(base_model, "apps/relay/ml-training/model_uncalibrated_prefit.pkl")

if __name__ == "__main__":
    calibrate_model()
