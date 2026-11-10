---
title: AlphaFold 3 - capabilities, evidence and operational limits
cells-tabs: tabbed
---

# AlphaFold 3: capabilities, evidence and operational limits

AlphaFold 3 extends structure prediction from proteins to joint complexes containing proteins, nucleic acids, small molecules, ions, modified residues and covalent modifications. Its 2024 Nature paper reports substantial gains in several interaction tasks, especially antibody interfaces and ligand poses. Later independent testing finds a more selective picture: large improvements for some interfaces, parity on global protein folds, and persistent failures on difficult RNA and antibody targets.

> **Practical conclusion:** AlphaFold 3 is most useful as a hypothesis generator inside an auditable workflow. A high-ranked structure is not experimental evidence by itself. Preserve the inputs, inspect all sampled structures, screen physical plausibility, compare alternatives and record the experimental test that could disconfirm the proposed interaction.

This report separates four questions that are often collapsed into one:

1. What changed in the model?
2. What did the original benchmark actually measure?
3. Which conclusions survived independent evaluation?
4. What evidence should a research team retain before acting on a prediction?

The values below come from the original AlphaFold 3 paper, its supplementary material, official implementation documentation, and an independent 2025 benchmark. Comparisons are only made within a task and metric. A percentage of correct ligand poses is not commensurate with protein LDDT or interface DockQ.

## 1. What changed technically

AlphaFold 2 predicts protein structures through residue-level representations and a structure module built around residue frames and torsion angles. AlphaFold 3 retains evolutionary and pairwise representations but replaces the final structure module with a diffusion process that predicts raw atom coordinates. It can therefore represent chemically heterogeneous complexes in one coordinate-generating system.[[1]](#source-1)

The published architecture also reduces the depth of multiple-sequence-alignment processing. It uses four MSA blocks and a 48-block Pairformer. The MSA still matters, but more of the representational work moves into pair and single representations before diffusion sampling.[[1]](#source-1)

~~~mermaid
flowchart LR
  A[Sequences, ligands, ions and modifications] --> B[MSA and template search]
  B --> C[Pair and single representations]
  C --> D[48-block Pairformer]
  D --> E[Diffusion over raw atom coordinates]
  E --> F[Multiple seeds and samples]
  F --> G[Confidence and clash-aware ranking]
  G --> H[Physical checks and comparative review]
  H --> I[Experimental validation]
~~~

Diffusion starts with noisy coordinates and iteratively denoises them. This lets the model learn both global arrangement and local stereochemistry, but it also makes the output stochastic. The same input can produce structures of meaningfully different quality. The original paper generally generated 25 candidates from five model seeds and five diffusion samples per seed, then selected by confidence. The antibody comparison was a major exception: both models were ranked across 1,000 seeds, with five diffusion samples per AlphaFold 3 seed.[[1]](#source-1)

The model's ability to produce plausible coordinates creates a specific failure mode: it can also produce plausible-looking structure where the biological system is disordered. The authors used cross-distillation from AlphaFold-Multimer predictions to reduce this behavior. That training intervention reduces a known problem, but does not establish that hallucinated order has been eliminated.[[1]](#source-1)

## 2. Confidence is a ranking signal, not a finding

The official implementation ranks candidates using predicted interface TM-score, predicted TM-score, a disorder term and a large clash penalty:[[2]](#source-2)

$$
S_{rank}=0.8\,ipTM+0.2\,pTM+0.5\,f_{disorder}-100\,I_{clash}
$$

Here, $I_{clash}$ is one when a severe clash is detected and zero otherwise. The formula is designed to sort candidates from one run. It is not a calibrated probability that a molecular interaction occurs.

The implementation documentation gives useful working ranges for $ipTM$: values above 0.8 are commonly treated as confident, values below 0.6 as likely failures, and 0.6 to 0.8 as a review zone. Those ranges remain heuristics. They do not replace ligand strain checks, residue-level confidence, comparison across samples or external evidence.[[2]](#source-2)

The output package supports that review. It contains the predicted structure in mmCIF, per-atom and pairwise confidence, a summary JSON, the processed input JSON with MSA and template information, and ranking scores for the generated samples. A reproducible record should preserve the whole package, not only the top-ranked mmCIF.[[2]](#source-2)

## 3. What the original benchmark supports

The main evaluation used structures released after a 30 September 2021 training cutoff. The recent-PDB evaluation set contained 8,856 complexes released between 1 May 2022 and 12 January 2023. Some analyses applied a maximum 40 percent sequence-identity filter to training chains. Peptides shorter than 16 residues were always filtered.[[1]](#source-1)

Across five selected tasks, AlphaFold 3 shows its largest reported gains on protein-DNA and antibody interfaces. Protein monomer accuracy changes little. Each bar pair below uses its own task-specific metric, so the valid comparison is baseline versus AlphaFold 3 within a category, not bar height across categories.

~~~chart
{
  "type": "bar",
  "title": "Original paper: selected head-to-head results",
  "subtitle": "Metric differs by category; compare paired bars only",
  "labels": [
    "Protein-RNA iLDDT",
    "Protein-DNA iLDDT",
    "Protein-protein correct %",
    "Antibody interface correct %",
    "Protein monomer LDDT"
  ],
  "datasets": [
    {
      "label": "Task baseline",
      "values": [
        19.0,
        28.3,
        67.5,
        29.6,
        85.5
      ]
    },
    {
      "label": "AlphaFold 3",
      "values": [
        39.4,
        64.8,
        76.6,
        62.9,
        86.9
      ]
    }
  ],
  "beginAtZero": true,
  "max": 100,
  "dataLabels": true,
  "legendPosition": "bottom"
}
~~~

The results support three narrower claims:

- **Protein complexes:** the share of protein-protein targets above DockQ 0.23 rose from 67.5 percent for AlphaFold-Multimer 2.3 to 76.6 percent for AlphaFold 3.
- **Antibody interfaces:** the corresponding success measure rose from 29.6 percent to 62.9 percent. This is a substantial improvement, but still leaves more than one third of targets outside the paper's success threshold.
- **Monomers:** mean LDDT moved from 85.5 to 86.9. AlphaFold 3 preserves strong monomer performance rather than creating a comparable step change.

The original paper also demonstrates structurally diverse examples: a protein-DNA-cGMP complex, a 4,665-residue glycosylated coronavirus spike complex with antibodies, and drug-like ligands in membrane-protein pockets. These examples establish representational breadth. They should not be read as prevalence estimates for success across all complexes.[[1]](#source-1)

## 4. Ligand docking: strong benchmark results, specific boundary conditions

For ligand docking, the paper reports the percentage of poses with pocket-aligned ligand RMSD below 2 angstroms. On PoseBusters V2, AlphaFold 3 reached 80.5 percent without a specified pocket and 93.2 percent when the true pocket was supplied. DiffDock reached 38.0 percent, GOLD 58.1 percent and Vina 59.7 percent in the comparison.[[1]](#source-1)

~~~chart
{
  "type": "horizontal_bar",
  "title": "PoseBusters V2: ligand poses below 2 angstrom RMSD",
  "labels": [
    "DiffDock",
    "GOLD",
    "Vina",
    "AlphaFold 3",
    "AlphaFold 3, pocket supplied"
  ],
  "values": [
    38.0,
    58.1,
    59.7,
    80.5,
    93.2
  ],
  "suffix": "%",
  "min": 0,
  "max": 100
}
~~~

RMSD answers whether the submitted ligand coordinates match the experimental pose after pocket alignment:

$$
RMSD=\sqrt{\frac{1}{N}\sum_{i=1}^{N}\lVert \mathbf{x}_i-\mathbf{y}_i\rVert^2}
$$

It does not by itself show that the pose is chemically valid, that the interaction has favorable binding free energy, or that the compound is active in a biological system. PoseBusters was created because docking methods can achieve favorable geometric scores while producing incorrect stereochemistry, strained conformations or physical clashes. Its tests cover chemical consistency, stereochemistry, intramolecular geometry, clashes and other plausibility checks.[[3]](#source-3)

Supplying the true pocket is also a different problem from blind docking. The 12.7-point difference between AlphaFold 3 with and without pocket information quantifies the value of knowing where to look on this benchmark. A workflow should record whether a pocket came from prior experimental knowledge, a separate predictor or the evaluated structure itself.

## 5. Independent evaluation narrows the claim

A 2025 independent benchmark evaluated AlphaFold 3 across nine recent datasets. It tested server and local predictions and compared them with task-specific predecessors. The results largely confirm broad utility while showing that the size and significance of the gain depend on the task.[[4]](#source-4)

### Protein folds are near parity

For 150 protein monomers released after January 2024, mean TM-score was 0.817 for the AlphaFold 3 server, 0.812 for local AlphaFold 3 and 0.812 for AlphaFold 2. The server difference from AlphaFold 2 was not statistically significant at $P=0.16$. On a stricter 52-target subset below 25 percent sequence identity, the authors again found no significant AlphaFold 3 advantage.[[4]](#source-4)

For 206 multimers, global mean TM-score was 0.821 for the server, 0.824 for local AlphaFold 3 and 0.812 for AlphaFold-Multimer. Those differences were also not statistically significant. This is compatible with AlphaFold 3 improving interfaces in selected cases without materially changing the global fold score across the whole set.

### Antibody interfaces improve, but remain difficult

On 102 antigen-antibody complexes, mean DockQ increased from 0.325 for AlphaFold-Multimer to 0.422 for the AlphaFold 3 server and 0.418 for local AlphaFold 3. The gains were statistically significant. Yet only 27.5 percent of server predictions and 28.4 percent of local predictions crossed DockQ 0.23, compared with 9.8 percent for AlphaFold-Multimer.[[4]](#source-4)

~~~chart
{
  "type": "bar",
  "title": "Independent antibody benchmark: mean interface DockQ",
  "labels": [
    "AlphaFold-Multimer",
    "AlphaFold 3 server",
    "AlphaFold 3 local"
  ],
  "values": [
    0.325,
    0.422,
    0.418
  ],
  "min": 0,
  "max": 0.5
}
~~~

This is a useful distinction between **relative gain** and **decision readiness**. A 29.8 percent relative improvement in mean DockQ can coexist with more than 70 percent of targets failing a permissive interface threshold.

### RNA remains a hard case

On 23 RNA multimers, AlphaFold 3 improved local LDDT over RoseTTAFoldNA, but mean global TM-score remained about 0.30 and only 2 of 23 targets achieved a correct global fold. The result supports better local geometry without supporting reliable global RNA-multimer prediction.[[4]](#source-4)

### Sampling and selection matter

The independent study observed broad quality distributions across repeated predictions for some targets. Server and local outputs sometimes differed even when their aggregate accuracy was similar. This is expected for a stochastic diffusion system and makes single-output reporting fragile. Report the distribution across seeds, the selection rule and whether the top-ranked sample was also the most accurate when a reference later became available.

## 6. A computed evidence workbook

The workbook below keeps original-paper results, independent results and runtime comparisons separate. Expand it to inspect formulas or download it as XLSX. The relative-change fields are calculations, not additional experimental estimates.

~~~cells evidence/Original paper
format: B=plain C=plain D=.3 E=.3 F=.3 G=%.1
Task,N,Metric,Baseline,AlphaFold 3,Absolute delta,Relative change
Protein-RNA,25,iLDDT,19.0,39.4,=E2-D2,=(E2-D2)/D2
Protein-DNA,38,iLDDT,28.3,64.8,=E3-D3,=(E3-D3)/D3
Protein-protein,1064,Percent DockQ above 0.23,67.5,76.6,=E4-D4,=(E4-D4)/D4
Antibody-protein,65,Percent DockQ above 0.23,29.6,62.9,=E5-D5,=(E5-D5)/D5
Protein monomer,338,LDDT,85.5,86.9,=E6-D6,=(E6-D6)/D6
PoseBusters V2,308,Percent ligand RMSD below 2 A,38.0,80.5,=E7-D7,=(E7-D7)/D7
~~~

~~~cells evidence/Independent benchmark
format: B=plain D=.3 E=.3 F=.3 G=%.1
Task,N,Metric,Baseline,AlphaFold 3,Absolute delta,Relative change,Interpretation
Protein monomers,150,Mean TM-score,0.812,0.817,=E2-D2,=(E2-D2)/D2,Server difference not significant
Protein multimers,206,Mean TM-score,0.812,0.821,=E3-D3,=(E3-D3)/D3,Server difference not significant
Antigen-antibody,102,Mean DockQ,0.325,0.422,=E4-D4,=(E4-D4)/D4,Significant interface gain
RNA multimers,23,Mean TM-score,0.242,0.300,=E5-D5,=(E5-D5)/D5,Global difference not significant
~~~

~~~cells evidence/Runtime
format: B=.0 C=.0 D=.1
Task,AlphaFold 3 minutes,Comparator minutes,Comparator divided by AlphaFold 3
Protein monomers,20,160,=C2/B2
Protein multimers,31,297,=C3/B3
Peptide-protein,34,272,=C4/B4
Antigen-antibody,47,382,=C5/B5
RNA monomers,10,445,=C6/B6
RNA multimers,11,799,=C7/B7
Protein-nucleic acid,23,996,=C8/B8
~~~

The runtime comparison used one NVIDIA A100 40 GB GPU with a specified CPU and memory setup. It shows a large throughput advantage in that benchmark, not a universal wall-clock guarantee. Database installation, MSA search, sequence length, complex size, hardware, compilation and batching all affect operational time.[[4]](#source-4)

## 7. An auditable research workflow

A research workbench can turn each prediction into a reviewable evidence object rather than a detached coordinate file.

~~~mermaid
flowchart TD
  A[Versioned biological question] --> B[Versioned sequences and chemical inputs]
  B --> C[Record databases, templates, MSAs and software versions]
  C --> D[Run multiple seeds and diffusion samples]
  D --> E[Retain every structure and confidence file]
  E --> F{Severe clash or invalid chemistry?}
  F -- yes --> G[Reject or rerun]
  F -- no --> H{ipTM below 0.6?}
  H -- yes --> I[Treat as failed interaction prediction]
  H -- no --> J{ipTM 0.6 to 0.8?}
  J -- yes --> K[Manual review and alternative methods]
  J -- no --> L[Advance as a structural hypothesis]
  K --> M[Orthogonal evidence and experiment]
  L --> M
~~~

The gate can be expressed in code, but the thresholds should remain visible and editable:

~~~python
def triage_prediction(summary):
    if summary["has_clash"]:
        return "reject_or_rerun"
    if summary["iptm"] < 0.60:
        return "failed_interaction_prediction"
    if summary["iptm"] < 0.80:
        return "manual_review"
    return "advance_as_hypothesis"


def evidence_record(run):
    return {
        "input_json": run.input_json,
        "database_versions": run.database_versions,
        "code_commit": run.code_commit,
        "weight_terms": run.weight_terms,
        "seed": run.seed,
        "all_samples": run.samples,
        "selection_rule": "ranking_score",
        "planned_validation": run.planned_validation,
    }
~~~

For ligand work, add stereochemistry, strain, clashes, pocket provenance and an orthogonal docking or physics-based check. For antibodies, inspect the complete sample distribution and interface residues. For RNA, place more weight on global-fold disagreement and alternative models. For every domain, separate a structural hypothesis from claims about binding affinity, activity, toxicity or clinical effect.

## 8. Reproducibility, licensing and current implementation state

The 2024 paper originally stated that model code and weights would not be made available. A later addendum records the updated release. The current official repository provides inference source code under Apache License 2.0, while the model parameters have separate terms of use. Output terms are also documented separately. A reproducibility record should therefore capture both the code version and the terms attached to the weights used for the run.[[5]](#source-5)[[6]](#source-6)

Official known-issues documentation also belongs in the evidence trail. It records hardware-specific clash failures on some older CUDA devices, a corrected SMILES atom-handling bug, and possible differences between local and server MSAs caused by different search configurations. These are not abstract implementation details: each can change the structure or its ranking.[[7]](#source-7)

The official repository describes the software as a tool for theoretical modeling and states that it is not intended or validated for clinical use. For drug discovery, structural biology or translational research, predicted coordinates can prioritize work, but experimental and domain-specific validation remains the decision boundary.[[6]](#source-6)

## 9. What this means for a scientific workbench

The useful unit is not a rendered structure. It is a traceable chain from question to input, model configuration, sample distribution, quality checks, interpretation and planned test.

A report layer should make the following visible together:

- the exact biological and chemical inputs;
- database, code and model versions;
- every seed and sample, not only the winner;
- confidence components and ranking formula;
- physical plausibility checks and pocket provenance;
- benchmark evidence relevant to the target class;
- alternative-model agreement or disagreement;
- the claim the structure supports and the claims it does not support;
- the experiment or observation that can falsify it.

That format makes computational output reviewable by structural biologists, medicinal chemists and research leads without flattening their different standards of evidence. It also creates a record that can be re-run when databases, model weights or scientific assumptions change.

## Sources

<a id="source-1"></a>**[1]** Abramson J, Adler J, Dunger J, et al. 2024. [Accurate structure prediction of biomolecular interactions with AlphaFold 3](https://doi.org/10.1038/s41586-024-07487-w). *Nature* 630:493-500. [Open full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11168924/).

<a id="source-2"></a>**[2]** Google DeepMind. [AlphaFold 3 output files and confidence measures](https://github.com/google-deepmind/alphafold3/blob/main/docs/output.md). Official implementation documentation.

<a id="source-3"></a>**[3]** Buttenschoen M, Morris GM, Deane CM. 2024. [PoseBusters: AI-based docking methods fail to generate physically valid poses or generalise to novel sequences](https://doi.org/10.1039/D3SC04185A). *Chemical Science* 15:3130-3139.

<a id="source-4"></a>**[4]** Liu X, et al. 2025. [A comprehensive benchmarking of the AlphaFold3 for predicting biomacromolecules and their interactions](https://doi.org/10.1093/bib/bbaf616). *Briefings in Bioinformatics*. [Open full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12661943/).

<a id="source-5"></a>**[5]** Abramson J, et al. 2024. [Author Correction: Accurate structure prediction of biomolecular interactions with AlphaFold 3](https://doi.org/10.1038/s41586-024-08416-7). *Nature*. [Open full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11634763/).

<a id="source-6"></a>**[6]** Google DeepMind. [AlphaFold 3 official repository](https://github.com/google-deepmind/alphafold3), including source license, model parameter terms and output terms.

<a id="source-7"></a>**[7]** Google DeepMind. [AlphaFold 3 known issues](https://github.com/google-deepmind/alphafold3/blob/main/docs/known_issues.md). Official implementation documentation.
