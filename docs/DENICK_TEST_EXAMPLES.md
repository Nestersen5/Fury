# AutoDenick test examples

These are synthetic, repeatable examples checked against the actual matching code, chat parser and chat formatter. No saved keys are read, no network requests are sent, and no real nicknames are saved or shared.

Run all examples and regenerate this report:

```powershell
node scripts/denick_examples.js
```

Run one example: `node scripts/denick_examples.js finals-two-to-three`. List IDs with `node scripts/denick_examples.js --list`.

The commands below describe the detected inputs. Running them normally in Minecraft uses live APIs; it does not inject these fictional players. Only this offline runner supplies the listed fake API replies.

Use `/denick test messages` in Minecraft for an offline showcase of all current stats-denick chat messages. It shows one/two/three-row possible-match groups and the confirmation/failure variants without changing entered test counts or sending requests. Search-start and too-many-single-stat messages are hidden, and match rows omit finals/beds comparisons. Backend counts and decisions remain in this report.

Discovery requests up to 50 candidates per stat. Verification checks up to 25 ranked profiles per search. Both stored stats in range take priority, followed by a single known stat in range, then older/outside-range totals and unknown counts. Closer known differences rank first within each group; ties preserve discovery order. A player outside the first 25 can still be missed. Names-only fixtures retain their supplied order because stored counts are unknown.

Rules: start at 100 below; widen to 200 below only with zero, one or two primary matches. Three primary matches prevent widening. Four or more matches in the chosen range suppress single-stat suggestions. Finals allow at most four above; beds allow none above. With both stats, the absolute beds gap must also be at most the absolute finals gap multiplied by 1.25 (25% extra). Both stats use 100 below without widening, and confirmation requires exactly one verified match from a successfully finished lookup. Full provider lists and the profile cap do not mark a successful search incomplete.

Live mode feeds server-shaped messages through the real chat parser; test mode executes `/denick test`. Their final chat messages are checked for equality. Simulated time advances instantly. Candidate counts describe checked profiles, so a provider/profile limit can still hide players. Detected counts are 1,000 for each entered stat unless an input block says otherwise. Fixtures set both stats to the same value unless a table below says otherwise.

Verified 75 scenarios in 149 live/test runs. External requests: **0**.

## Finals only

| ID | Supplied finals / beds | Primary matches | Widened? | Result |
|---|---|---:|---|---|
| finals-zero | Alpha 799/799 | 0 | Yes | No match; silently wait for the other stat |
| finals-zero-to-one | Alpha 850/850 | 0 | Yes | Possible: Alpha |
| finals-zero-to-two | Alpha 850/850; Bravo 800/800 | 0 | Yes | Possible: Alpha, Bravo |
| finals-zero-to-three | Alpha 899/899; Bravo 850/850; Charlie 800/800 | 0 | Yes | Possible: Alpha, Bravo, Charlie |
| finals-zero-to-four | Alpha 899/899; Bravo 850/850; Charlie 825/825; Delta 800/800 | 0 | Yes | Too many matches; no chat message |
| finals-one | Alpha 1000/1000; Bravo 799/799 | 1 | Yes | Possible: Alpha |
| finals-one-to-two | Alpha 1000/1000; Bravo 850/850 | 1 | Yes | Possible: Alpha, Bravo |
| finals-one-to-three | Alpha 1000/1000; Bravo 850/850; Charlie 800/800 | 1 | Yes | Possible: Alpha, Bravo, Charlie |
| finals-one-to-four | Alpha 1000/1000; Bravo 899/899; Charlie 850/850; Delta 800/800 | 1 | Yes | Too many matches; no chat message |
| finals-two | Alpha 1000/1000; Bravo 950/950; Charlie 799/799 | 2 | Yes | Possible: Alpha, Bravo |
| finals-two-to-three | Alpha 1000/1000; Bravo 950/950; Charlie 850/850 | 2 | Yes | Possible: Alpha, Bravo, Charlie |
| finals-two-to-four | Alpha 1000/1000; Bravo 950/950; Charlie 850/850; Delta 800/800 | 2 | Yes | Too many matches; no chat message |
| finals-three | Alpha 1000/1000; Bravo 950/950; Charlie 900/900; Delta 850/850 | 3 | No | Possible: Alpha, Bravo, Charlie |
| finals-four | Alpha 1000/1000; Bravo 990/990; Charlie 950/950; Delta 900/900; Echo 850/850 | 4 | No | Too many matches; no chat message |
| finals-minus100 | Alpha 900/900 | 1 | Yes | Possible: Alpha |
| finals-minus101 | Alpha 899/899 | 0 | Yes | Possible: Alpha |
| finals-minus200 | Alpha 800/800 | 0 | Yes | Possible: Alpha |
| finals-minus201 | Alpha 799/799 | 0 | Yes | No match; silently wait for the other stat |
| finals-ceiling | Alpha 1004/1004 | 1 | Yes | Possible: Alpha |
| finals-above-ceiling | Alpha 1005/1005 | 0 | Yes | No match; silently wait for the other stat |
| finals-empty | Empty list | 0 | Yes | No match; silently wait for the other stat |
| finals-duplicates | Alpha 1000/1000 | 1 | Yes | Possible: Alpha |
| finals-limited | Alpha 1000/1000 | 1 | Yes | Possible: Alpha |
| finals-count-zero | Alpha 0/0 | 1 | Yes | Possible: Alpha |

## Beds only

| ID | Supplied finals / beds | Primary matches | Widened? | Result |
|---|---|---:|---|---|
| beds-zero | Alpha 799/799 | 0 | Yes | No match; silently wait for the other stat |
| beds-zero-to-one | Alpha 850/850 | 0 | Yes | Possible: Alpha |
| beds-zero-to-two | Alpha 850/850; Bravo 800/800 | 0 | Yes | Possible: Alpha, Bravo |
| beds-zero-to-three | Alpha 899/899; Bravo 850/850; Charlie 800/800 | 0 | Yes | Possible: Alpha, Bravo, Charlie |
| beds-zero-to-four | Alpha 899/899; Bravo 850/850; Charlie 825/825; Delta 800/800 | 0 | Yes | Too many matches; no chat message |
| beds-one | Alpha 1000/1000; Bravo 799/799 | 1 | Yes | Possible: Alpha |
| beds-one-to-two | Alpha 1000/1000; Bravo 850/850 | 1 | Yes | Possible: Alpha, Bravo |
| beds-one-to-three | Alpha 1000/1000; Bravo 850/850; Charlie 800/800 | 1 | Yes | Possible: Alpha, Bravo, Charlie |
| beds-one-to-four | Alpha 1000/1000; Bravo 899/899; Charlie 850/850; Delta 800/800 | 1 | Yes | Too many matches; no chat message |
| beds-two | Alpha 1000/1000; Bravo 950/950; Charlie 799/799 | 2 | Yes | Possible: Alpha, Bravo |
| beds-two-to-three | Alpha 1000/1000; Bravo 950/950; Charlie 850/850 | 2 | Yes | Possible: Alpha, Bravo, Charlie |
| beds-two-to-four | Alpha 1000/1000; Bravo 950/950; Charlie 850/850; Delta 800/800 | 2 | Yes | Too many matches; no chat message |
| beds-three | Alpha 1000/1000; Bravo 950/950; Charlie 900/900; Delta 850/850 | 3 | No | Possible: Alpha, Bravo, Charlie |
| beds-four | Alpha 1000/1000; Bravo 990/990; Charlie 950/950; Delta 900/900; Echo 850/850 | 4 | No | Too many matches; no chat message |
| beds-minus100 | Alpha 900/900 | 1 | Yes | Possible: Alpha |
| beds-minus101 | Alpha 899/899 | 0 | Yes | Possible: Alpha |
| beds-minus200 | Alpha 800/800 | 0 | Yes | Possible: Alpha |
| beds-minus201 | Alpha 799/799 | 0 | Yes | No match; silently wait for the other stat |
| beds-ceiling | Alpha 1000/1000 | 1 | Yes | Possible: Alpha |
| beds-above-ceiling | Alpha 1001/1001 | 0 | Yes | No match; silently wait for the other stat |
| beds-empty | Empty list | 0 | Yes | No match; silently wait for the other stat |
| beds-duplicates | Alpha 1000/1000 | 1 | Yes | Possible: Alpha |
| beds-limited | Alpha 1000/1000 | 1 | Yes | Possible: Alpha |
| beds-count-zero | Alpha 0/0 | 1 | Yes | Possible: Alpha |

## Both stats

| ID | Supplied finals / beds | Primary matches | Widened? | Result |
|---|---|---:|---|---|
| combined-unique | Alpha 1000/1000 | - | - | Confirmed: Alpha |
| combined-two | Alpha 1000/1000; Bravo 950/950 | - | - | Multiple combined matches; no confirmation |
| combined-none | Alpha 1000/1001 | - | - | No combined match |
| combined-minus100 | Alpha 900/900 | - | - | Confirmed: Alpha |
| combined-minus101-finals | Alpha 899/1000 | - | - | No combined match |
| combined-minus101-beds | Alpha 1000/899 | - | - | No combined match |
| combined-finals-plus4 | Alpha 1004/1000 | - | - | Confirmed: Alpha |
| combined-finals-plus5 | Alpha 1005/1000 | - | - | No combined match |
| combined-beds-plus1 | Alpha 1000/1001 | - | - | No combined match |
| combined-one-list | Alpha 1000/1000 | - | - | Confirmed: Alpha |
| combined-gap25-62 | Alpha 950/938 | - | - | Confirmed: Alpha |
| combined-gap25-63 | Alpha 950/937 | - | - | No combined match |
| combined-gap25-exact | Alpha 996/995 | - | - | Confirmed: Alpha |
| combined-gap25-zero | Alpha 1000/999 | - | - | No combined match |
| combined-limited | Alpha 1000/1000 | - | - | Confirmed: Alpha |
| combined-limit-25 | 26 players (see details) | - | - | No combined match |
| combined-one-within-limit | 26 players (see details) | - | - | Confirmed: Player0 |

## Latest counts

| ID | Supplied finals / beds | Primary matches | Widened? | Result |
|---|---|---:|---|---|
| latest-finals | Alpha 1001/1000 | - | - | Confirmed: Alpha |
| latest-finals-pending | Alpha 1001/1000 | - | - | Confirmed: Alpha |
| latest-beds | Alpha 1000/1001 | - | - | Confirmed: Alpha |
| latest-beds-pending | Alpha 1000/1001 | - | - | Confirmed: Alpha |

## Errors and limits

| ID | Supplied finals / beds | Primary matches | Widened? | Result |
|---|---|---:|---|---|
| error-single-discovery | Alpha 1000/1000 | - | - | API error; no result |
| error-single-profile | Alpha 1000/1000 | - | - | API error; no result |
| error-combined-discovery | Alpha 1000/1000 | - | - | API error; no result |
| error-combined-profile | Alpha 1000/1000 | - | - | API error; no result |
| limit-single-25 | 26 players (see details) | 0 | Yes | No match; silently wait for the other stat |

## Test command

| ID | Supplied finals / beds | Primary matches | Widened? | Result |
|---|---|---:|---|---|
| test-reset | Alpha 1000/1000 | 1 | Yes | Possible: Alpha |

## Inputs and actual chat

For multiple-step examples, each output block includes the full sequence. The JSON report also contains each lookup trace, accepted/rejected names and profile-check counts.

<details>
<summary>finals-zero: No matches in either range</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 799 | 799 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-zero-to-one: No primary matches; widening finds one</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 850 | 850 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-zero-to-two: No primary matches; widening finds two</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 850 | 850 |
| Bravo | 800 | 800 |

**Automatic chat detection**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-zero-to-three: No primary matches; widening finds three</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 899 |
| Bravo | 850 | 850 |
| Charlie | 800 | 800 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-zero-to-four: No primary matches; widening finds too many</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 899 |
| Bravo | 850 | 850 |
| Charlie | 825 | 825 |
| Delta | 800 | 800 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-one: One primary match; widening finds nobody else</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 799 | 799 |

**Automatic chat detection**: Possible: Alpha. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-one-to-two: One primary match; widening adds one</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 850 | 850 |

**Automatic chat detection**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-one-to-three: One primary match; widening adds two</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 850 | 850 |
| Charlie | 800 | 800 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-one-to-four: One primary match; widening finds too many</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 899 | 899 |
| Charlie | 850 | 850 |
| Delta | 800 | 800 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-two: Two primary matches; widening finds nobody else</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 799 | 799 |

**Automatic chat detection**: Possible: Alpha, Bravo. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-two-to-three: Two primary matches; widening fills the third slot</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 850 | 850 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-two-to-four: Two primary matches; widening finds a fourth</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 850 | 850 |
| Delta | 800 | 800 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-three: Three primary matches; ignore a player 150 below</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 900 | 900 |
| Delta | 850 | 850 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 4 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 4 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-four: Four primary matches; stop checking further players</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 990 | 990 |
| Charlie | 950 | 950 |
| Delta | 900 | 900 |
| Echo | 850 | 850 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-minus100: Exactly 100 below belongs to the primary range</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 900 | 900 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-minus101: Exactly 101 below needs widening</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 899 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-minus200: Exactly 200 below is accepted after widening</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 800 | 800 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-minus201: Exactly 201 below is rejected</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 799 | 799 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-ceiling: Highest allowed total above the detected count</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1004 | 1004 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.04  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.04  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-above-ceiling: One above the upper allowance is rejected</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1005 | 1005 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-empty: Aurora returns nobody</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 0 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 0 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>finals-duplicates: Repeated names are checked and displayed once</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Discovery lists: `{"finals":["Alpha","ALPHA"]}`.

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-limited: A full provider list does not mark the search incomplete</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Discovery lists: `{"finals":["Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha"]}`.

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>finals-count-zero: A detected total of zero is valid</summary>

**Inputs**

```text
/denick test finals 0
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 0 | 0 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 0.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 0.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-zero: No matches in either range</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 799 | 799 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-zero-to-one: No primary matches; widening finds one</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 850 | 850 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-zero-to-two: No primary matches; widening finds two</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 850 | 850 |
| Bravo | 800 | 800 |

**Automatic chat detection**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-zero-to-three: No primary matches; widening finds three</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 899 |
| Bravo | 850 | 850 |
| Charlie | 800 | 800 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-zero-to-four: No primary matches; widening finds too many</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 899 |
| Bravo | 850 | 850 |
| Charlie | 825 | 825 |
| Delta | 800 | 800 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-one: One primary match; widening finds nobody else</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 799 | 799 |

**Automatic chat detection**: Possible: Alpha. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-one-to-two: One primary match; widening adds one</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 850 | 850 |

**Automatic chat detection**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-one-to-three: One primary match; widening adds two</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 850 | 850 |
| Charlie | 800 | 800 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 8.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-one-to-four: One primary match; widening finds too many</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 899 | 899 |
| Charlie | 850 | 850 |
| Delta | 800 | 800 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-two: Two primary matches; widening finds nobody else</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 799 | 799 |

**Automatic chat detection**: Possible: Alpha, Bravo. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-two-to-three: Two primary matches; widening fills the third slot</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 850 | 850 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 3 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 8.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-two-to-four: Two primary matches; widening finds a fourth</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 850 | 850 |
| Delta | 800 | 800 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-three: Three primary matches; ignore a player 150 below</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |
| Charlie | 900 | 900 |
| Delta | 850 | 850 |

**Automatic chat detection**: Possible: Alpha, Bravo, Charlie. Last search checked 4 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha, Bravo, Charlie. Last search checked 4 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[250✫] TestNick (Charlie) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-four: Four primary matches; stop checking further players</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 990 | 990 |
| Charlie | 950 | 950 |
| Delta | 900 | 900 |
| Echo | 850 | 850 |

**Automatic chat detection**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

**/denick test**: Too many matches; no chat message. Last search checked 4 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-minus100: Exactly 100 below belongs to the primary range</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 900 | 900 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-minus101: Exactly 101 below needs widening</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 899 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-minus200: Exactly 200 below is accepted after widening</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 800 | 800 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-minus201: Exactly 201 below is rejected</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 799 | 799 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-ceiling: Highest allowed total above the detected count</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-above-ceiling: One above the upper allowance is rejected</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1001 | 1001 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 1 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-empty: Aurora returns nobody</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 0 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 0 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>beds-duplicates: Repeated names are checked and displayed once</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Discovery lists: `{"beds":["Alpha","ALPHA"]}`.

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-limited: A full provider list does not mark the search incomplete</summary>

**Inputs**

```text
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Discovery lists: `{"beds":["Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha"]}`.

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>beds-count-zero: A detected total of zero is valid</summary>

**Inputs**

```text
/denick test beds 0
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 0 | 0 |

**Automatic chat detection**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 0.00  WLR: 3.00  WS: 4
```

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 0.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-unique: One complete match confirms</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-two: Two players match both stats</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |
| Bravo | 950 | 950 |

**Automatic chat detection**: Multiple combined matches; no confirmation. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: Multiple combined matches; no confirmation. Last search checked 2 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[250✫] TestNick (Bravo) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-none: No player matches both stats</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1001 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-minus100: Both stats exactly 100 below can confirm</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 900 | 900 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 9.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 9.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-minus101-finals: Combined finals do not widen to 200</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 899 | 1000 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 8.99  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-minus101-beds: Combined beds do not widen to 200</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 899 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-finals-plus4: Four extra finals and no extra beds can confirm</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1004 | 1000 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.04  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.04  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.04  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-finals-plus5: Five extra finals prevent confirmation</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1005 | 1000 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-beds-plus1: One extra bed prevents confirmation</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1001 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-one-list: A player in only one list can still confirm</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Discovery lists: `{"finals":["Alpha"],"beds":[]}`.

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-gap25-62: A 50-finals gap permits a 62-beds gap</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 950 | 938 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 9.50  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 9.50  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-gap25-63: A 50-finals gap rejects a 63-beds gap</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 950 | 937 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.50  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-gap25-exact: A four-finals gap permits exactly five beds</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 996 | 995 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 9.96  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 9.96  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 9.96  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>combined-gap25-zero: Exact finals require exact beds</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 999 |

**Automatic chat detection**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-limited: One verified match confirms despite a full provider list</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Discovery lists: `{"finals":["Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha","Alpha"],"beds":["Alpha"]}`.

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>latest-finals: Use the latest finals when beds arrives</summary>

**Inputs**

```text
/denick test finals 1000
Wait 60 seconds (simulated).
/denick test finals 1001
Wait 60 seconds (simulated).
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1001 | 1000 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.01  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.01  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.01  WLR: 3.00  WS: 4
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.01  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.01  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>latest-finals-pending: Use the latest finals when beds arrives during the first search</summary>

**Inputs**

```text
/denick test finals 1000
Wait 60 seconds (simulated).
/denick test finals 1001
Wait 60 seconds (simulated).
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1001 | 1000 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.01  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.01  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.01  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>latest-beds: Use the latest beds when finals arrives</summary>

**Inputs**

```text
/denick test beds 1000
Wait 60 seconds (simulated).
/denick test beds 1001
Wait 60 seconds (simulated).
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1001 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>latest-beds-pending: Use the latest beds when finals arrives during the first search</summary>

**Inputs**

```text
/denick test beds 1000
Wait 60 seconds (simulated).
/denick test beds 1001
Wait 60 seconds (simulated).
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1001 |

**Automatic chat detection**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Alpha) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>error-single-discovery: Aurora failure is an error, not no matches</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Aurora returns a failed response.

**Automatic chat detection**: API error; no result. Last search checked 0 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
```

**/denick test**: API error; no result. Last search checked 0 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
```

</details>

<details>
<summary>error-single-profile: Hypixel failure is an error, not no matches</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Hypixel lookup for Alpha returns an error.

**Automatic chat detection**: API error; no result. Last search checked 1 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
```

**/denick test**: API error; no result. Last search checked 1 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
```

</details>

<details>
<summary>error-combined-discovery: Aurora failure is an error, not no matches</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Aurora returns a failed response.

**Automatic chat detection**: API error; no result. Last search checked 0 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
[AutoDenick] Could not check TestNick right now.
```

**/denick test**: API error; no result. Last search checked 0 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
```

</details>

<details>
<summary>error-combined-profile: Hypixel failure is an error, not no matches</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

Hypixel lookup for Alpha returns an error.

**Automatic chat detection**: API error; no result. Last search checked 1 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
[AutoDenick] Could not check TestNick right now.
```

**/denick test**: API error; no result. Last search checked 1 profile(s); lookup failed.

```text
[AutoDenick] Could not check TestNick right now.
```

</details>

<details>
<summary>limit-single-25: The 26th player is not checked beyond the profile limit when stored counts are unknown</summary>

**Inputs**

```text
/denick test finals 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Player0 | 799 | 799 |
| Player1 | 799 | 799 |
| Player2 | 799 | 799 |
| Player3 | 799 | 799 |
| Player4 | 799 | 799 |
| Player5 | 799 | 799 |
| Player6 | 799 | 799 |
| Player7 | 799 | 799 |
| Player8 | 799 | 799 |
| Player9 | 799 | 799 |
| Player10 | 799 | 799 |
| Player11 | 799 | 799 |
| Player12 | 799 | 799 |
| Player13 | 799 | 799 |
| Player14 | 799 | 799 |
| Player15 | 799 | 799 |
| Player16 | 799 | 799 |
| Player17 | 799 | 799 |
| Player18 | 799 | 799 |
| Player19 | 799 | 799 |
| Player20 | 799 | 799 |
| Player21 | 799 | 799 |
| Player22 | 799 | 799 |
| Player23 | 799 | 799 |
| Player24 | 799 | 799 |
| Player25 | 1000 | 1000 |

**Automatic chat detection**: No match; silently wait for the other stat. Last search checked 25 profile(s); lookup finished.

```text
```

**/denick test**: No match; silently wait for the other stat. Last search checked 25 profile(s); lookup finished.

```text
```

</details>

<details>
<summary>combined-limit-25: A match after the profile limit remains unknown without stored counts to prioritize it</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Player0 | 799 | 799 |
| Player1 | 799 | 799 |
| Player2 | 799 | 799 |
| Player3 | 799 | 799 |
| Player4 | 799 | 799 |
| Player5 | 799 | 799 |
| Player6 | 799 | 799 |
| Player7 | 799 | 799 |
| Player8 | 799 | 799 |
| Player9 | 799 | 799 |
| Player10 | 799 | 799 |
| Player11 | 799 | 799 |
| Player12 | 799 | 799 |
| Player13 | 799 | 799 |
| Player14 | 799 | 799 |
| Player15 | 799 | 799 |
| Player16 | 799 | 799 |
| Player17 | 799 | 799 |
| Player18 | 799 | 799 |
| Player19 | 799 | 799 |
| Player20 | 799 | 799 |
| Player21 | 799 | 799 |
| Player22 | 799 | 799 |
| Player23 | 799 | 799 |
| Player24 | 799 | 799 |
| Player25 | 1000 | 1000 |

**Automatic chat detection**: No combined match. Last search checked 25 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

**/denick test**: No combined match. Last search checked 25 profile(s); lookup finished.

```text
[AutoDenick] Could not confidently denick TestNick using their finals and beds.
```

</details>

<details>
<summary>combined-one-within-limit: One checked match confirms without checking the 26th player</summary>

**Inputs**

```text
/denick test finals 1000 beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Player0 | 1000 | 1000 |
| Player1 | 799 | 799 |
| Player2 | 799 | 799 |
| Player3 | 799 | 799 |
| Player4 | 799 | 799 |
| Player5 | 799 | 799 |
| Player6 | 799 | 799 |
| Player7 | 799 | 799 |
| Player8 | 799 | 799 |
| Player9 | 799 | 799 |
| Player10 | 799 | 799 |
| Player11 | 799 | 799 |
| Player12 | 799 | 799 |
| Player13 | 799 | 799 |
| Player14 | 799 | 799 |
| Player15 | 799 | 799 |
| Player16 | 799 | 799 |
| Player17 | 799 | 799 |
| Player18 | 799 | 799 |
| Player19 | 799 | 799 |
| Player20 | 799 | 799 |
| Player21 | 799 | 799 |
| Player22 | 799 | 799 |
| Player23 | 799 | 799 |
| Player24 | 799 | 799 |
| Player25 | 1000 | 1000 |

**Automatic chat detection**: Confirmed: Player0. Last search checked 25 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Player0) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Confirmed match: [250✫] TestNick (Player0) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

**/denick test**: Confirmed: Player0. Last search checked 25 profile(s); lookup finished.

```text
[AutoDenick] Confirmed match: [250✫] TestNick (Player0) ✔  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>

<details>
<summary>test-reset: Reset clears the first stat before entering another</summary>

**Inputs**

```text
/denick test finals 1000
/denick test reset
/denick test beds 1000
```

| Player | Finals | Beds |
|---|---:|---:|
| Alpha | 1000 | 1000 |

**/denick test**: Possible: Alpha. Last search checked 1 profile(s); lookup finished.

```text
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
[AutoDenick] Test counts cleared.
[AutoDenick] Possible matches:
[250✫] TestNick (Alpha) ?  FKDR: 10.00  WLR: 3.00  WS: 4
```

</details>
