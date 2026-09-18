import fs from 'fs';
import path from 'path';

export interface MLClassificationResult {
  replyIntent: string;
  confidenceScore: number;
  belowThreshold: boolean;
  classificationReason: string;
  probabilities: Record<string, number>;
}

export interface EmailInput {
  subject?: string;
  fullBodyText?: string;
  bodyPreview?: string;
  latestBody?: string;
}

let modelData: any = null;

export function reloadModel() {
  modelData = null;
  return loadModel();
}

function resolveModelPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../ml-training/model_export.json'),
    path.resolve(process.cwd(), 'ml-training/model_export.json'),
    path.resolve(process.cwd(), 'apps/relay/ml-training/model_export.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadModel() {
  if (modelData) return modelData;
  try {
    const modelPath = resolveModelPath();
    if (!modelPath) {
      console.warn('[relay-ml] model_export.json not found (checked ml-training paths)');
      return null;
    }
    const data = fs.readFileSync(modelPath, 'utf8');
    modelData = JSON.parse(data);
    return modelData;
  } catch (error) {
    console.error('Error loading ML model:', error);
    return null;
  }
}

function extractFeatures(text: string, vocabulary: Record<string, number>, idf: number[]): number[] {
  // Lowercase
  text = text.toLowerCase();
  
  // Tokenize using regex matching Python's r"(?u)\b\w\w+\b"
  const tokens = text.match(/\b\w\w+\b/g) || [];
  
  // Count term frequencies
  const tf = new Map<number, number>();
  for (const token of tokens) {
    const idx = vocabulary[token];
    if (idx !== undefined) {
      tf.set(idx, (tf.get(idx) || 0) + 1);
    }
  }
  
  // Compute TF-IDF
  const vector = new Array(idf.length).fill(0);
  let sqSum = 0;
  for (const [idx, count] of tf.entries()) {
    const tfidf = count * idf[idx];
    vector[idx] = tfidf;
    sqSum += tfidf * tfidf;
  }
  
  // L2 Normalization
  if (sqSum > 0) {
    const norm = Math.sqrt(sqSum);
    for (let i = 0; i < vector.length; i++) {
      if (vector[i] !== 0) {
        vector[i] = vector[i] / norm;
      }
    }
  }
  
  return vector;
}

export function classifyEmailMessageML(emailData: EmailInput): MLClassificationResult | null {
  const model = loadModel();
  if (!model) {
    return null; // Model not available
  }
  
  // Combine subject and body like ruleClassifier does
  const subject = (emailData.subject || '').trim();
  const body = (emailData.latestBody || emailData.fullBodyText || emailData.bodyPreview || '').trim();
  const text = `${subject} | ${body}`;
  
  // Extract features
  const vector = extractFeatures(text, model.vocabulary, model.idf);
  
  // Compute raw scores based on model type
  const numClasses = model.classes.length;
  const rawScores = new Array(numClasses).fill(0);
  
  if (model.model_type === "naive_bayes") {
    for (let c = 0; c < numClasses; c++) {
      let score = model.class_log_prior[c];
      const featLogProb = model.feature_log_prob[c];
      for (let i = 0; i < vector.length; i++) {
        if (vector[i] !== 0) {
          score += vector[i] * featLogProb[i];
        }
      }
      rawScores[c] = score;
    }
  } else {
    // Legacy Logistic Regression
    for (let c = 0; c < numClasses; c++) {
      let score = model.intercepts[c];
      const coef = model.coefficients[c];
      for (let i = 0; i < vector.length; i++) {
        if (vector[i] !== 0) {
          score += vector[i] * coef[i];
        }
      }
      rawScores[c] = score;
    }
  }
  
  // Convert scores to probabilities
  const probabilities = new Array(numClasses).fill(0);
  let probSum = 0;
  
  if (model.model_type === "naive_bayes") {
    // Softmax for Naive Bayes log probabilities
    const maxLogProb = Math.max(...rawScores);
    for (let c = 0; c < numClasses; c++) {
      const prob = Math.exp(rawScores[c] - maxLogProb);
      probabilities[c] = prob;
      probSum += prob;
    }
  } else {
    // Platt scaling for Logistic Regression
    const { a, b } = model.calibration;
    for (let c = 0; c < numClasses; c++) {
      const f = rawScores[c];
      const A = a[c][0] !== undefined ? a[c][0] : a[c];
      const B = b[c][0] !== undefined ? b[c][0] : b[c];
      const prob = 1.0 / (1.0 + Math.exp(A * f + B));
      probabilities[c] = prob;
      probSum += prob;
    }
  }
  
  // Normalize probabilities to sum to 1
  let topClassIdx = 0;
  let maxProb = 0;
  const probMap: Record<string, number> = {};
  
  for (let c = 0; c < numClasses; c++) {
    const normalizedProb = probSum > 0 ? probabilities[c] / probSum : 0;
    probMap[model.classes[c]] = normalizedProb;
    
    if (normalizedProb > maxProb) {
      maxProb = normalizedProb;
      topClassIdx = c;
    }
  }
  
  const predictedClass = model.classes[topClassIdx];
  const abstentionThreshold = model.abstention_threshold || 0.72;
  const isConfident = maxProb >= abstentionThreshold;
  
  if (!isConfident) {
    return {
      replyIntent: predictedClass,
      confidenceScore: maxProb,
      belowThreshold: true,
      classificationReason: `ML abstained: confidence ${maxProb.toFixed(3)} < threshold ${abstentionThreshold}`,
      probabilities: probMap
    };
  }
  
  return {
    replyIntent: predictedClass,
    confidenceScore: maxProb,
    belowThreshold: false,
    classificationReason: `ML classification: confidence ${maxProb.toFixed(3)}`,
    probabilities: probMap
  };
}
