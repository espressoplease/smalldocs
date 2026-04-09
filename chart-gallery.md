# SDocs Chart Gallery

Every chart type supported by SDocs, with examples and their JSON.

## Pie & Doughnut

```chart
{"type":"pie","title":"Browser Market Share","labels":["Chrome","Safari","Firefox","Edge","Other"],"values":[65,19,4,4,8]}
```

```json
{
  "type": "pie",
  "title": "Browser Market Share",
  "labels": ["Chrome", "Safari", "Firefox", "Edge", "Other"],
  "values": [65, 19, 4, 4, 8]
}
```

```chart
{"type":"doughnut","title":"Budget Allocation","labels":["Engineering","Marketing","Sales","Support","R&D"],"values":[35,20,18,12,15]}
```

```json
{
  "type": "doughnut",
  "title": "Budget Allocation",
  "labels": ["Engineering", "Marketing", "Sales", "Support", "R&D"],
  "values": [35, 20, 18, 12, 15]
}
```

## Bar Charts

### Standard Bar

```chart
{"type":"bar","title":"Quarterly Revenue","subtitle":"FY2024 vs FY2025 comparison","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"2024","values":[12,18,15,22]},{"label":"2025","values":[15,24,20,28]}],"xAxis":"Quarter","yAxis":"Revenue","format":"currency"}
```

```json
{
  "type": "bar",
  "title": "Quarterly Revenue",
  "subtitle": "FY2024 vs FY2025 comparison",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "datasets": [
    { "label": "2024", "values": [12, 18, 15, 22] },
    { "label": "2025", "values": [15, 24, 20, 28] }
  ],
  "xAxis": "Quarter",
  "yAxis": "Revenue",
  "format": "currency"
}
```

### Horizontal Bar

```chart
{"type":"horizontal_bar","title":"Programming Language Popularity","labels":["JavaScript","Python","TypeScript","Java","Go","Rust"],"values":[95,88,78,70,55,42],"xAxis":"Score"}
```

```json
{
  "type": "horizontal_bar",
  "title": "Programming Language Popularity",
  "labels": ["JavaScript", "Python", "TypeScript", "Java", "Go", "Rust"],
  "values": [95, 88, 78, 70, 55, 42],
  "xAxis": "Score"
}
```

### Stacked Bar

```chart
{"type":"stacked_bar","title":"Revenue by Source","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"Product","values":[10,12,14,16]},{"label":"Services","values":[5,7,6,8]},{"label":"Licensing","values":[3,3,4,5]}],"yAxis":"Revenue ($M)","format":"currency"}
```

```json
{
  "type": "stacked_bar",
  "title": "Revenue by Source",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "datasets": [
    { "label": "Product", "values": [10, 12, 14, 16] },
    { "label": "Services", "values": [5, 7, 6, 8] },
    { "label": "Licensing", "values": [3, 3, 4, 5] }
  ],
  "yAxis": "Revenue ($M)",
  "format": "currency"
}
```

## Line Charts

### Multi-series Line

```chart
{"type":"line","title":"User Growth","subtitle":"Free vs paid tier adoption","labels":["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug"],"datasets":[{"label":"Free","values":[1000,1200,1500,1800,2200,2800,3500,4200]},{"label":"Pro","values":[100,120,180,250,340,420,510,630]}],"yAxis":"Users","format":"comma"}
```

```json
{
  "type": "line",
  "title": "User Growth",
  "subtitle": "Free vs paid tier adoption",
  "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
  "datasets": [
    { "label": "Free", "values": [1000, 1200, 1500, 1800, 2200, 2800, 3500, 4200] },
    { "label": "Pro", "values": [100, 120, 180, 250, 340, 420, 510, 630] }
  ],
  "yAxis": "Users",
  "format": "comma"
}
```

### Area Chart

```chart
{"type":"area","title":"CPU Usage Over 24 Hours","labels":["00:00","03:00","06:00","09:00","12:00","15:00","18:00","21:00"],"values":[12,8,15,65,72,58,45,22],"yAxis":"Usage","format":"percent"}
```

```json
{
  "type": "area",
  "title": "CPU Usage Over 24 Hours",
  "labels": ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"],
  "values": [12, 8, 15, 65, 72, 58, 45, 22],
  "yAxis": "Usage",
  "format": "percent"
}
```

### Stacked Area

```chart
{"type":"stacked_area","title":"Traffic Sources","labels":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],"datasets":[{"label":"Organic","values":[400,450,480,520,510,300,280]},{"label":"Direct","values":[200,220,210,250,240,180,170]},{"label":"Referral","values":[100,120,130,110,140,90,80]}],"yAxis":"Visits"}
```

```json
{
  "type": "stacked_area",
  "title": "Traffic Sources",
  "labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  "datasets": [
    { "label": "Organic", "values": [400, 450, 480, 520, 510, 300, 280] },
    { "label": "Direct", "values": [200, 220, 210, 250, 240, 180, 170] },
    { "label": "Referral", "values": [100, 120, 130, 110, 140, 90, 80] }
  ],
  "yAxis": "Visits"
}
```

## Radar

```chart
{"type":"radar","title":"Team Skill Comparison","labels":["Frontend","Backend","DevOps","Design","Testing","Communication"],"datasets":[{"label":"Alice","values":[9,7,5,8,6,9]},{"label":"Bob","values":[6,9,8,4,7,7]}]}
```

```json
{
  "type": "radar",
  "title": "Team Skill Comparison",
  "labels": ["Frontend", "Backend", "DevOps", "Design", "Testing", "Communication"],
  "datasets": [
    { "label": "Alice", "values": [9, 7, 5, 8, 6, 9] },
    { "label": "Bob", "values": [6, 9, 8, 4, 7, 7] }
  ]
}
```

## Scatter Plot

```chart
{"type":"scatter","title":"Height vs Weight","datasets":[{"label":"Male","data":[{"x":170,"y":70},{"x":175,"y":80},{"x":180,"y":85},{"x":165,"y":65},{"x":185,"y":92},{"x":178,"y":78}]},{"label":"Female","data":[{"x":155,"y":50},{"x":160,"y":55},{"x":165,"y":60},{"x":158,"y":52},{"x":170,"y":65},{"x":163,"y":57}]}],"xAxis":"Height (cm)","yAxis":"Weight (kg)"}
```

```json
{
  "type": "scatter",
  "title": "Height vs Weight",
  "datasets": [
    {
      "label": "Male",
      "data": [
        {"x": 170, "y": 70}, {"x": 175, "y": 80}, {"x": 180, "y": 85},
        {"x": 165, "y": 65}, {"x": 185, "y": 92}, {"x": 178, "y": 78}
      ]
    },
    {
      "label": "Female",
      "data": [
        {"x": 155, "y": 50}, {"x": 160, "y": 55}, {"x": 165, "y": 60},
        {"x": 158, "y": 52}, {"x": 170, "y": 65}, {"x": 163, "y": 57}
      ]
    }
  ],
  "xAxis": "Height (cm)",
  "yAxis": "Weight (kg)"
}
```

## Polar Area

```chart
{"type":"polarArea","title":"Time Spent by Activity","labels":["Coding","Meetings","Code Review","Planning","Break","Learning"],"values":[35,18,12,15,10,10]}
```

```json
{
  "type": "polarArea",
  "title": "Time Spent by Activity",
  "labels": ["Coding", "Meetings", "Code Review", "Planning", "Break", "Learning"],
  "values": [35, 18, 12, 15, 10, 10]
}
```

## Advanced Options

### Title + Subtitle

```chart
{"type":"bar","title":"Annual Revenue by Region","subtitle":"All figures in USD millions — FY2025","labels":["North America","Europe","Asia Pacific","Latin America"],"values":[145,98,76,32],"yAxis":"Revenue","format":"currency"}
```

```json
{
  "type": "bar",
  "title": "Annual Revenue by Region",
  "subtitle": "All figures in USD millions — FY2025",
  "labels": ["North America", "Europe", "Asia Pacific", "Latin America"],
  "values": [145, 98, 76, 32],
  "yAxis": "Revenue",
  "format": "currency"
}
```

### Custom Axis Range + Suffix

```chart
{"type":"line","title":"Temperature This Week","labels":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],"values":[18,21,19,24,26,23,20],"yAxis":"Temperature","suffix":"°C","min":10,"max":35,"stepSize":5}
```

```json
{
  "type": "line",
  "title": "Temperature This Week",
  "labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  "values": [18, 21, 19, 24, 26, 23, 20],
  "yAxis": "Temperature",
  "suffix": "°C",
  "min": 10,
  "max": 35,
  "stepSize": 5
}
```

### Horizontal Bar with Percent

```chart
{"type":"horizontal_bar","title":"Project Completion","labels":["Backend API","Frontend UI","Testing","Documentation","Deployment"],"values":[92,78,65,45,30],"xAxis":"Progress","format":"percent","max":100}
```

```json
{
  "type": "horizontal_bar",
  "title": "Project Completion",
  "labels": ["Backend API", "Frontend UI", "Testing", "Documentation", "Deployment"],
  "values": [92, 78, 65, 45, 30],
  "xAxis": "Progress",
  "format": "percent",
  "max": 100
}
```

### Mixed Chart — Dual Y-Axis (Bar + Line)

```chart
{"type":"mixed","title":"Revenue vs Growth Rate","subtitle":"Bars show revenue, line shows quarter-over-quarter growth","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"Revenue ($M)","type":"bar","values":[50,65,80,95],"yAxisID":"y"},{"label":"Growth %","type":"line","values":[12,30,23,19],"yAxisID":"y2"}],"yAxis":"Revenue","y2Axis":"Growth Rate","format":"currency","y2Format":"percent"}
```

```json
{
  "type": "mixed",
  "title": "Revenue vs Growth Rate",
  "subtitle": "Bars show revenue, line shows quarter-over-quarter growth",
  "labels": ["Q1", "Q2", "Q3", "Q4"],
  "datasets": [
    { "label": "Revenue ($M)", "type": "bar", "values": [50, 65, 80, 95], "yAxisID": "y" },
    { "label": "Growth %", "type": "line", "values": [12, 30, 23, 19], "yAxisID": "y2" }
  ],
  "yAxis": "Revenue",
  "y2Axis": "Growth Rate",
  "format": "currency",
  "y2Format": "percent"
}
```

### Annotations — Reference Lines

```chart
{"type":"bar","title":"Monthly Sales vs Target","labels":["Jan","Feb","Mar","Apr","May","Jun"],"values":[42,58,65,48,72,80],"yAxis":"Sales ($K)","format":"currency","annotations":[{"y":60,"label":"Target","color":"#ef4444"}]}
```

```json
{
  "type": "bar",
  "title": "Monthly Sales vs Target",
  "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  "values": [42, 58, 65, 48, 72, 80],
  "yAxis": "Sales ($K)",
  "format": "currency",
  "annotations": [
    { "y": 60, "label": "Target", "color": "#ef4444" }
  ]
}
```

### No Data Labels

```chart
{"type":"line","title":"Stock Price","subtitle":"5-day closing prices","labels":["Mon","Tue","Wed","Thu","Fri"],"datasets":[{"label":"AAPL","values":[182,185,183,188,191]},{"label":"GOOGL","values":[141,139,142,144,143]}],"yAxis":"Price ($)","format":"currency","dataLabels":false,"beginAtZero":false}
```

```json
{
  "type": "line",
  "title": "Stock Price",
  "subtitle": "5-day closing prices",
  "labels": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "datasets": [
    { "label": "AAPL", "values": [182, 185, 183, 188, 191] },
    { "label": "GOOGL", "values": [141, 139, 142, 144, 143] }
  ],
  "yAxis": "Price ($)",
  "format": "currency",
  "dataLabels": false,
  "beginAtZero": false
}
```

---

Run `sdoc charts` for the full reference of all options, data formats, and styling.
