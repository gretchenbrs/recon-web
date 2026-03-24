# Data Reconciliation Report

## 1. Requirement
Business Requirement: Advanced Order-Payment Reconciliation

Objective:
Reconcile order records from the order system with payment records from the payment gateway, ensuring accuracy, completeness, and auditability.

Important Constraint:
- The dashboard structure and metrics are FIXED and should not be modified.
- Any additional analysis, insights, or advanced metrics MUST be included in a detailed reconciliation report (text output).

---

Reconciliation Rules:

1. Key Mapping:
   - Match orders.order_id with payments.txn_reference
   - Matching should ignore case and trim whitespace


2. Amount Validation:
   - Compare orders.order_amount with payments.paid_amount
   - Flag mismatches where absolute difference > 2 USD
   - Also compute percentage difference for reporting

---

Exception Types to Identify:

- Missing Payments:
  Orders that have no corresponding payment

- Orphan Payments:
  Payments that do not map to any order

- Amount Mismatches:
  Records where amount difference exceeds tolerance

- Late Payments:
  Payments occurring beyond the allowed time window


---

Additional Reporting (REQUIRED):

In addition to the dashboard, generate a detailed reconciliation report including:

1. Breakdown of Issues:
   - Count and percentage of each issue type

2. Financial Impact:
   - Total discrepancy value
   - Top 5 largest mismatches

3. Timing Analysis:
   - Average payment delay
   - Distribution of delays (on-time vs late)

4. Data Quality Insights:
   - Duplicate keys (if any)
   - Suspicious patterns (e.g., repeated mismatches)

5. Field Mapping Explanation:
   - Explain how columns were matched (order_id ↔ txn_reference, etc.)

6. Summary:
   - High-level explanation of reconciliation health
   - Key risks or anomalies detected

---

Goal:
Ensure the reconciliation process is not only accurate but also explainable and auditable, with clear insights provided in the report beyond the fixed dashboard metrics.


## 2. Dataset Scope
- Dataset A: orders_complex.csv
- Dataset B: payments_complex.csv
- Records in A: 30
- Records in B: 28

## 3. Recon Spec
```json
{
  "keyA": "order_id",
  "keyB": "txn_reference",
  "amountA": "order_amount",
  "amountB": "paid_amount",
  "tolerance": 0.01,
  "ignoreCase": true,
  "flagDuplicates": true,
  "detectOrphans": true,
  "source": "manual"
}
```

## 4. Dashboard Metrics
```json
{
  "matched": 27,
  "missingInB": 3,
  "missingInA": 1,
  "amountMismatches": 5,
  "nullKeyCount": 0,
  "duplicateKeyCount": 0,
  "totalA": 30,
  "totalB": 28,
  "totalErrorValue": 25,
  "avgMismatchError": 5,
  "maxMismatchError": 5,
  "matchRate": 0.9,
  "issueRate": 0.3,
  "orphanRate": 0.03571428571428571,
  "joinCoverage": 1.0666666666666667,
  "nullKeyRatio": 0,
  "duplicateKeyRatio": 0,
  "issueTotal": 9,
  "exceptions": [
    {
      "id": "ORD0005",
      "amountA": "$248.44",
      "amountB": "$253.44",
      "difference": "-$5.00",
      "issueType": "Amount Mismatch",
      "severity": "low"
    },
    {
      "id": "ORD0010",
      "amountA": "$285.31",
      "amountB": "$280.31",
      "difference": "+$5.00",
      "issueType": "Amount Mismatch",
      "severity": "low"
    },
    {
      "id": "ORD0015",
      "amountA": "$203.74",
      "amountB": "$208.74",
      "difference": "-$5.00",
      "issueType": "Amount Mismatch",
      "severity": "low"
    },
    {
      "id": "ORD0020",
      "amountA": "$323.86",
      "amountB": "$328.86",
      "difference": "-$5.00",
      "issueType": "Amount Mismatch",
      "severity": "low"
    },
    {
      "id": "ORD0025",
      "amountA": "$248.59",
      "amountB": "$243.59",
      "difference": "+$5.00",
      "issueType": "Amount Mismatch",
      "severity": "low"
    },
    {
      "id": "ORD0028",
      "amountA": "$462.27",
      "amountB": "-",
      "difference": "$462.27",
      "issueType": "Missing in B",
      "severity": "high"
    },
    {
      "id": "ORD0029",
      "amountA": "$239.34",
      "amountB": "-",
      "difference": "$239.34",
      "issueType": "Missing in B",
      "severity": "high"
    },
    {
      "id": "ORD0030",
      "amountA": "$295.03",
      "amountB": "-",
      "difference": "$295.03",
      "issueType": "Missing in B",
      "severity": "high"
    },
    {
      "id": "ORD9999",
      "amountA": "-",
      "amountB": "$120.00",
      "difference": "-$120.00",
      "issueType": "Missing in A",
      "severity": "high"
    }
  ]
}
```

## 5. Exception Samples
```json
[
  {
    "id": "ORD0005",
    "amountA": "$248.44",
    "amountB": "$253.44",
    "difference": "-$5.00",
    "issueType": "Amount Mismatch",
    "severity": "low"
  },
  {
    "id": "ORD0010",
    "amountA": "$285.31",
    "amountB": "$280.31",
    "difference": "+$5.00",
    "issueType": "Amount Mismatch",
    "severity": "low"
  },
  {
    "id": "ORD0015",
    "amountA": "$203.74",
    "amountB": "$208.74",
    "difference": "-$5.00",
    "issueType": "Amount Mismatch",
    "severity": "low"
  },
  {
    "id": "ORD0020",
    "amountA": "$323.86",
    "amountB": "$328.86",
    "difference": "-$5.00",
    "issueType": "Amount Mismatch",
    "severity": "low"
  },
  {
    "id": "ORD0025",
    "amountA": "$248.59",
    "amountB": "$243.59",
    "difference": "+$5.00",
    "issueType": "Amount Mismatch",
    "severity": "low"
  },
  {
    "id": "ORD0028",
    "amountA": "$462.27",
    "amountB": "-",
    "difference": "$462.27",
    "issueType": "Missing in B",
    "severity": "high"
  },
  {
    "id": "ORD0029",
    "amountA": "$239.34",
    "amountB": "-",
    "difference": "$239.34",
    "issueType": "Missing in B",
    "severity": "high"
  },
  {
    "id": "ORD0030",
    "amountA": "$295.03",
    "amountB": "-",
    "difference": "$295.03",
    "issueType": "Missing in B",
    "severity": "high"
  },
  {
    "id": "ORD9999",
    "amountA": "-",
    "amountB": "$120.00",
    "difference": "-$120.00",
    "issueType": "Missing in A",
    "severity": "high"
  }
]
```

## 6. Analyst Notes
- Match quality appears in the dashboard metrics above.
- Prioritize critical and high severity exceptions first.
- Re-run reconciliation after resolving schema and key-quality issues.
