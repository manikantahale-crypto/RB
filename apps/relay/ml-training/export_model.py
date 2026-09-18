import json
import joblib
from datetime import datetime

def export_model():
    print("Loading models for export...")
    vectorizer = joblib.load("apps/relay/ml-training/vectorizer.pkl")
    base_model = joblib.load("apps/relay/ml-training/model_uncalibrated_prefit.pkl")
    calibrated_model = joblib.load("apps/relay/ml-training/model_calibrated.pkl")
    
    # 1. Vocabulary
    vocab = vectorizer.vocabulary_
    
    # 2. IDF weights
    idf = vectorizer.idf_.tolist()
    
    # 3. Classes
    classes = base_model.classes_.tolist()
    
    # 4. Coefficients & Intercepts
    coef = base_model.coef_.tolist()
    intercept = base_model.intercept_.tolist()
    
    # 5. Calibration params
    # calibrated_classifiers_ is a list of fitted estimators. Since cv='prefit', there's only 1 estimator.
    calibrated_estimator = calibrated_model.calibrated_classifiers_[0]
    
    # calibrators_ contains one calibrator per class for multi-class
    a_params = []
    b_params = []
    
    for calibrator in calibrated_estimator.calibrators:
        # Calibrator is _SigmoidCalibration or similar
        # Depending on scikit-learn version, they are stored in `a_` and `b_`
        a_params.append(calibrator.a_)
        b_params.append(calibrator.b_)
        
    calibration = {
        "method": "platt",
        "a": a_params,
        "b": b_params
    }
    
    # 6. Abstention threshold
    # From evaluation, choosing 0.72 is a reasonable default for high confidence
    abstention_threshold = 0.72
    
    export_data = {
        "version": datetime.utcnow().isoformat() + "Z",
        "vocabulary": vocab,
        "idf": idf,
        "classes": classes,
        "coefficients": coef,
        "intercepts": intercept,
        "calibration": calibration,
        "abstention_threshold": abstention_threshold
    }
    
    with open("apps/relay/ml-training/model_export.json", "w") as f:
        json.dump(export_data, f)
        
    print("Model successfully exported to apps/relay/ml-training/model_export.json")

if __name__ == "__main__":
    export_model()
