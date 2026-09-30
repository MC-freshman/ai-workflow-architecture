<!-- stage:SPEC -->
Read the audit and input data. Define objective, units, assumptions, tolerances and a traceable confirmation in model_spec.yaml. Do not manufacture user confirmation.
<!-- /stage:SPEC -->

<!-- stage:BASELINE -->
Create src/baseline.py and deterministic baseline metrics using the confirmed specification. Execute the locked isolated stage tool and retain actual outputs.
<!-- /stage:BASELINE -->

<!-- stage:SOLVE -->
Create src/solver.py and solve the confirmed model. Verify coefficients, constraints, units and reproducibility using the locked stage tool.
<!-- /stage:SOLVE -->

<!-- stage:VALIDATE -->
Define and execute independent numerical checks. Record actual validation results, not an unconditional PASS.
<!-- /stage:VALIDATE -->

<!-- stage:FIGURES -->
Generate figures from registered numerical results. Run all deterministic QA checks, inspect actual previews, record a hash-bound visual review with observations, then run the stage acceptance tool.
<!-- /stage:FIGURES -->