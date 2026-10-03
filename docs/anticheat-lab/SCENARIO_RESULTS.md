# Per-scenario results

Generated from `output/anticheat-lab/final-analysis-v2/summary.json`. Each row has 100 unique validated gameplay trials: 50 calibration and 50 held out. Flags count labeled actors receiving any tier from any detector; flags on `legit_` rows are false positives. Enabled no-op boundaries are included in the 50 but excluded from effect-expected denominators.

| Scenario | Calibration before ? after | Held out before ? after | Held-out effect-expected trials | Held-out enabled no-op trials |
|---|---:|---:|---:|---:|
| legit_movement | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| timer | 0/50 ? 0/50 | 0/50 ? 0/50 | 45 | 5 |
| clicker_extra | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| clicker_extraplus | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| clicker_normal | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| legit_clicking | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| blockhit_auto | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | 50 |
| blockhit_auto_paired | 0/50 ? 0/50 | 0/50 ? 0/50 | 45 | 5 |
| blockhit_lag | 32/50 ? 17/50 | 31/50 ? 8/50 | 40 | 10 |
| blockhit_manual | 0/50 ? 0/50 | 0/50 ? 0/50 | 36 | 14 |
| blockhit_predict | 0/50 ? 0/50 | 0/50 ? 0/50 | 45 | 5 |
| legit_blockhit | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| fastplace_all | 0/50 ? 0/50 | 0/50 ? 0/50 | 39 | 11 |
| fastplace_blocks | 0/50 ? 0/50 | 0/50 ? 0/50 | 20 | 30 |
| fastplace_projectiles | 0/50 ? 0/50 | 0/50 ? 0/50 | 19 | 31 |
| legit_heldplace | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| legit_manualplace | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| blink_all_both_auto | 1/50 ? 0/50 | 0/50 ? 0/50 | 40 | 10 |
| blink_all_both_manual | 0/50 ? 0/50 | 1/50 ? 1/50 | 50 | 0 |
| blink_all_outgoing_auto | 1/50 ? 0/50 | 0/50 ? 0/50 | 40 | 10 |
| blink_all_outgoing_manual | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| blink_movement_both_auto | 3/50 ? 3/50 | 4/50 ? 4/50 | 40 | 10 |
| blink_movement_both_manual | 6/50 ? 5/50 | 6/50 ? 6/50 | 50 | 0 |
| blink_movement_outgoing_auto | 6/50 ? 4/50 | 4/50 ? 4/50 | 40 | 10 |
| blink_movement_outgoing_manual | 6/50 ? 6/50 | 6/50 ? 6/50 | 50 | 0 |
| legit_jumpcombat | 2/50 ? 0/50 | 1/50 ? 0/50 | 0 | ? |
| legit_sneakbridge | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| scaffold_godbridge_cardinal | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| scaffold_godbridge_turn | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| scaffold_legit | 0/50 ? 0/50 | 0/50 ? 0/50 | 50 | 0 |
| legit_ladder_blockchange | 36/50 ? 0/50 | 33/50 ? 0/50 | 0 | ? |
| legit_ladder_preexisting | 33/50 ? 0/50 | 29/50 ? 0/50 | 0 | ? |
| blink_sneaking_movement | 7/50 ? 0/50 | 7/50 ? 0/50 | 50 | 0 |
| legit_jumpcombat_sneaking | 0/50 ? 0/50 | 0/50 ? 0/50 | 0 | ? |
| legit_blockhit_defensive | 7/50 ? 0/50 | 13/50 ? 0/50 | 0 | ? |

Timing, tiers, family-specific counts, artifact hashes and individual trial IDs are retained in the JSON summary and underlying score files. These scripted rates do not estimate human-population error rates.
