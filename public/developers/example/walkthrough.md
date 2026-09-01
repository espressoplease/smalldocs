---
title: Guided launch review
docwalk: true
annotations:
  - line: 3
    quote: "one operating question"
    text: "Start with the decision the team needs to make."
  - line: 14
    text: "The second step opens the computed scenario sheet."
  - line: 20
    text: "The final step is a runnable sensitivity control."
styles:
  fontFamily: Inter
  accent: "#31598a"
---
# Launch review

This walkthrough keeps the analysis tied to one operating question: how much reserve capacity should the pilot carry?

## Scenario model

~~~cells launch/Inputs
Metric,Value
Weekly demand,120
Reserve rate,0.15
~~~

~~~cells launch/Summary
Metric,Value
Reserve units,=Inputs!B2*Inputs!B3
~~~

## Sensitivity control

~~~~sdoc-app
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reserve sensitivity</title>
  <style>
    body { display: grid; gap: 18px; }
    output { font-size: 2rem; font-weight: 650; color: var(--sdoc-app-accent-color); }
    label { display: grid; gap: 8px; }
  </style>
</head>
<body>
  <strong>Reserve rate</strong>
  <output id="value">15%</output>
  <label>Adjust the assumption <input id="rate" type="range" min="5" max="30" value="15"></label>
  <script>
    const rate = document.getElementById('rate');
    const value = document.getElementById('value');
    rate.addEventListener('input', () => { value.textContent = rate.value + '%'; });
  </script>
</body>
</html>
~~~~
