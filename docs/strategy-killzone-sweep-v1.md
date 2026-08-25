# Stratégie **KZ-Sweep v1** — spécification mécanique

**Statut :** spec figée (Phase 1) · implémentation Pine à faire (Phase 2)
**Source d'origine :** `examples/pine/killzones.pine` (indicateur — détection seule, aucune règle de trade)
**Cadre :** `spec-trading.md` (mandat, contraintes, gates)
**Dernière mise à jour :** 2026-08-25

> Règle de lecture : toute règle ci-dessous est **décidable par une machine**. Aucun terme d'appréciation
> (« si le marché semble faible », « si le mouvement est propre ») n'est admis. Toute règle non écrite ici
> n'existe pas — en cas de doute pendant l'implémentation, la spec est modifiée puis re-validée, pas contournée.

---

## 0. Résumé en une phrase

Pendant la killzone de Londres, on prend position **contre** un balayage de liquidité du range asiatique
lorsque le prix **revient clôturer à l'intérieur du range** ; le stop va au-delà de l'extrême du balayage,
la cible est la liquidité opposée du range, et la position est plate à la fin de la killzone.

---

## 1. Univers, timeframe, sessions

| Élément | Valeur v1 |
|---------|-----------|
| Symbole de recherche | `NQ1!` (continu, backtest) |
| Symbole d'exécution | `MNQ` front-month (1 pt = 2 $, 1 tick = 0,25 pt = 0,50 $) |
| Timeframe de signal | M5 (voir `spec-trading.md` §5 pour la validation M15) |
| Fuseau de référence | `America/New_York` — DST géré par Pine, jamais en dur |
| Session asiatique (range) | 20:00 → 00:00 ET, jours de **début** : dimanche → jeudi |
| Killzone de Londres (trading) | 02:00 → 05:00 ET, jours : lundi → vendredi |
| Killzone New York AM | 08:30 → 11:30 ET — **désactivée en v1** (variante V2) |

---

## 2. Définitions

Reprises telles quelles de l'indicateur, avec les références de ligne :

- **Range asiatique** — `asiaH` / `asiaL` : plus haut et plus bas atteints pendant la session asiatique.
  Accumulés bougie par bougie, **figés à la fin de la session** (`killzones.pine:106-131`).
- **Jour de rattachement** — `rangeDay` : jour calendaire (fuseau ET) de la **fin** de la session asiatique,
  c'est-à-dire le jour de bourse qui va être tradé (`killzones.pine:104`, `:124`).
- **Range exploitable** — `rangeOk` : range défini **et** rattaché au jour courant **et** session asiatique
  terminée **et** filtre d'amplitude passé (`killzones.pine:136-137`).
- **Balayage (sweep)** — le prix dépasse un extrême du range **en mèche** : `high > asiaH` ou `low < asiaL`
  sur une bougie **confirmée** (`killzones.pine:148-155`).
- **Armement** — un balayage n'est exploitable que s'il s'est produit **pendant** la fenêtre de trading.
  L'état est mémorisé au moment du dépassement (`killzones.pine:152`).
- **Récupération** — une bougie confirmée **clôture de nouveau à l'intérieur** du range :
  `close < asiaH` après un balayage du haut, `close > asiaL` après un balayage du bas
  (`killzones.pine:163-168`). C'est le déclencheur du signal.
- **Extrême du balayage** — `sweepExtreme` : le plus bas atteint entre le début du balayage et la
  récupération incluse (cas bas) ; le plus haut (cas haut). *Ajout v1 : l'indicateur ne le mémorise pas.*

---

## 3. Filtres d'éligibilité

Tous doivent être vrais. Un seul faux → **aucun trade**, journalisé avec le motif.

| ID | Filtre | Règle |
|----|--------|-------|
| **F1** | Timeframe | Intraday et ≤ 1H (`killzones.pine:66`). Sinon la stratégie ne calcule rien. |
| **F2** | Range défini | `asiaH` / `asiaL` non nuls et `rangeDay == jour courant` |
| **F3** | Hors session asiatique | Pas de trade tant que le range se forme |
| **F4** | Amplitude du range | `0,5 × M20 ≤ (asiaH − asiaL) ≤ 2,5 × M20`, où **M20** = moyenne des 20 derniers ranges asiatiques valides. Filtre auto-calibrant : pas de valeur en points en dur, qui dériverait avec le niveau du NQ. |
| **F5** | Fraîcheur du niveau | Le côté visé ne doit pas avoir déjà été dépassé **avant** l'ouverture de la killzone. Un niveau pris à 01:30 ET est mort pour la journée, même s'il est « récupéré » à 02:10 (`killzones.pine:148-155` : `brokeX` se verrouille, `armedX` reste faux). |
| **F6** | Délai de récupération | ≤ **6 bougies** entre la bougie de balayage et la bougie de récupération (30 min en M5). Au-delà, ce n'est plus un rejet, c'est une dérive. |
| **F7** | Ratio risque/rendement | `distance à la cible / distance au stop ≥ 1,5`. Sinon trade rejeté (`skip_rr`). |
| **F8** | Quota journalier | **1 trade par jour maximum**, premier signal valide uniquement, tous côtés confondus. |
| **F9** | Sizing réalisable | Taille calculée ≥ 1 contrat, sinon trade rejeté (`skip_size`, cf. `spec-trading.md` §4). |
| **F10** | Coupure journalière | Perte cumulée du jour ≥ 1 % du capital → plus aucun trade jusqu'au lendemain. |

---

## 4. Entrée

| ID | Règle |
|----|-------|
| **E1** | Le signal est évalué **uniquement sur bougie confirmée** (`barstate.isconfirmed`). |
| **E2** | **Long** : balayage de `asiaL` armé, puis bougie confirmée avec `close > asiaL`, F1→F10 vrais. |
| **E3** | **Short** : balayage de `asiaH` armé, puis bougie confirmée avec `close < asiaH`, F1→F10 vrais. |
| **E4** | Exécution **au marché à l'ouverture de la bougie suivante**. Jamais sur la bougie de signal : c'est ce qui rend le backtest et l'exécution réelle comparables. |
| **E5** | Un seul signal par côté et par range (`doneH` / `doneL`, `killzones.pine:163-168`), et un seul trade par jour (F8). |

---

## 5. Stop, cible, sorties

| ID | Règle |
|----|-------|
| **S1** | **Stop initial** — Long : `sweepExtreme − 0,10 × (asiaH − asiaL)`. Short : `sweepExtreme + 0,10 × (asiaH − asiaL)`. Plancher : 2 ticks au-delà de l'extrême. |
| **S2** | **Cible** — Long : `asiaH`. Short : `asiaL`. La liquidité opposée du range, pas un multiple arbitraire. |
| **S3** | **Sortie temps** — clôture au marché à **05:00 ET** (fin de la killzone de Londres) si ni stop ni cible n'ont été touchés. Aucune position n'est portée au-delà. |
| **S4** | **Aucun breakeven, aucun trailing, aucune sortie partielle en v1.** Trois sorties possibles, point. (Variantes V3/V4.) |
| **S5** | **Le stop et la cible sont transmis au broker en même temps que l'entrée** (bracket OCO). Ils ne dépendent pas de la survie du bot. |
| **S6** | **Convention pessimiste** — si une bougie contient à la fois le stop et la cible, le **stop** est réputé touché en premier. À vérifier dans le Strategy Tester en Phase 3 (activer le Bar Magnifier si disponible). |

---

## 6. Dimensionnement

```
distanceStop (points) = |entrée − stop|
risqueParContrat ($)  = distanceStop × 2 $        (MNQ)
budgetRisque ($)      = equity × 0,005            (D-03)
qty                   = plancher(budgetRisque / risqueParContrat)
qty                   = min(qty, 10)              (garde-fou maxContracts)
si qty < 1            → trade non pris, journalisé skip_size   (F9)
```

L'`equity` de référence est celle du **début de journée**, pas celle en cours : le sizing ne doit pas
varier en cours de session au gré des flottants.

---

## 7. Contrat de signal (payload d'alerte)

Payload émis par `alert()` à chaque événement d'ordre. C'est l'interface figée entre la Phase 2 et la Phase 5 :

```json
{
  "v": 1,
  "signal_id": "kzsweep-v1|MNQ|5|1774598400000|entry_long",
  "ts": "2026-03-24T06:20:00Z",
  "strategy": "kzsweep-v1",
  "symbol": "MNQ",
  "timeframe": "5",
  "action": "entry_long",
  "qty": 3,
  "ref_price": 20125.50,
  "sl": 20083.25,
  "tp": 20241.00,
  "reason": "sweep_low_recovery"
}
```

| Champ | Règle |
|-------|-------|
| `signal_id` | **Déterministe** : `strategy|symbol|timeframe|heure_ouverture_barre_ms|action`. Deux émissions du même événement produisent le même id → c'est ce qui rend l'idempotence de l'exécuteur vérifiable (gate Phase 5). |
| `action` | `entry_long` · `entry_short` · `exit_time` · `exit_manual` |
| `sl` / `tp` | Toujours présents sur une entrée. Une entrée sans `sl` doit être **rejetée** par l'exécuteur. |
| `qty` | Calculée en Pine à titre indicatif ; l'exécuteur **recalcule** à partir de l'equity réelle du broker et prend le minimum des deux. |

---

## 8. Règles anti-repainting

Non négociables — ce sont elles qui rendent le backtest crédible.

1. Signal évalué uniquement sur bougie confirmée (E1) ; exécution à l'ouverture suivante (E4).
2. `calc_on_every_tick = false`, `process_orders_on_close = false`.
3. Aucun `request.security()` en v1. Si une variante en introduit un : jamais `lookahead_on`.
4. Aucun accès à `high`/`low`/`close` d'une bougie non close pour la décision.
5. **Test de non-repainting (gate Phase 3)** : la liste de trades produite en backtest doit être identique
   à celle produite en `replay_*` sur la même fenêtre. Un écart = repainting, retour Phase 2.

---

## 9. Paramètres

| Paramètre | Valeur v1 | Plage à balayer en Phase 3 |
|-----------|-----------|-----------------------------|
| `tz` | `America/New_York` | fixe |
| `sesAsia` | `2000-0000`, jours dim→jeu | fixe |
| `sesLdn` | `0200-0500`, jours lun→ven | fixe |
| `sesNy` | `0830-1130` — **off** | on/off (V2) |
| `maxBarsRecovery` | 6 | 2 → 12 |
| `rangeMinFactor` | 0,5 × M20 | 0,3 → 0,8 |
| `rangeMaxFactor` | 2,5 × M20 | 1,5 → 4,0 |
| `stopBufferPct` | 0,10 × range | 0,05 → 0,25 |
| `minRR` | 1,5 | 1,0 → 2,5 |
| `riskPct` | 0,5 % | fixe (D-03) |
| `maxContracts` | 10 | fixe |
| `maxTradesPerDay` | 1 | 1 → 2 (V2) |

**Hypothèses de coût pour le backtest** (à confirmer avec le broker retenu, D-08) :
commission **1,00 $ par contrat et par côté**, slippage **2 ticks** à l'entrée et **2 ticks** au stop.
Un backtest sans ces coûts n'est pas recevable.

---

## 10. Jeu de cas de référence

Gate de Phase 1 : chaque cas doit donner **une décision unique** à la lecture de la spec.
Sert ensuite de checklist de validation en replay (Phase 4).

| # | Situation | Décision attendue |
|---|-----------|-------------------|
| 1 | Balayage de `asiaL` à 02:40 ET, clôture de retour dans le range 2 bougies après, range à 1,1 × M20, R:R = 2,4 | **Long** à l'ouverture de la bougie suivante |
| 2 | Mèche sous `asiaL` mais aucune clôture ne revient dans le range avant 05:00 ET | Aucun trade |
| 3 | `asiaL` pris à 01:30 ET (hors killzone), récupération à 02:10 | Aucun trade — F5, le niveau n'est plus frais |
| 4 | Balayage à 02:10, récupération à 02:55 (9 bougies M5) | Rejeté — F6 (max 6) |
| 5 | Range asiatique = 0,35 × M20 | Journée ignorée — F4 (plancher) |
| 6 | Range asiatique = 3,1 × M20 | Journée ignorée — F4 (plafond) |
| 7 | Setup long valide mais `asiaH` n'est qu'à 1,2 R de l'entrée | Rejeté — F7 (`skip_rr`) |
| 8 | Long pris à 02:40 ; à 04:10 le haut du range est balayé puis rejeté | 2ᵉ signal ignoré — F8 (quota) et E5 |
| 9 | Long en cours, ni stop ni cible touchés à 05:00 ET | Clôture au marché à 05:00 ET — S3 |
| 10 | Une bougie traverse à la fois le stop et la cible | Stop réputé touché en premier — S6 |
| 11 | Budget de risque = 40 $, risque du contrat = 110 $ | Aucun trade — F9 (`skip_size`) |
| 12 | Jour de rollover `NQ1!` | Journée exclue des statistiques de backtest, signalée dans le rapport |

---

## 11. Notes d'implémentation pour la Phase 2

- **IMP-1 — Jours de session distincts.** L'indicateur applique un `sesDays` unique aux trois sessions
  (`killzones.pine:74-80`). La stratégie doit les **séparer** : Asie dim→jeu, Londres lun→ven. Réutiliser
  le paramètre commun produirait un décalage d'un jour sur la killzone.
- **IMP-2 — Mémoriser `sweepExtreme`.** L'indicateur ne conserve que l'instant du dépassement
  (`brokeHBar` / `brokeLBar`), pas l'extrême atteint. Le stop en dépend (S1) : à ajouter.
- **IMP-3 — Moyenne M20 des ranges.** Nouvel état : file glissante des 20 derniers ranges valides (F4).
- **IMP-4 — `alert()` et non `alertcondition()`.** Les `alertcondition()` existants
  (`killzones.pine:185-194`) ne transportent pas de payload dynamique. La v1 utilise `alert()` avec le
  JSON du §7, ou `alert_message` sur les ordres.
- **IMP-5 — Le fichier `killzones.pine` n'est pas modifié.** La stratégie est un nouveau fichier,
  l'indicateur reste l'outil visuel de contrôle.
- **IMP-6 — Validation offline d'abord** : `pine_analyze` puis `pine_check` avant toute injection sur le chart.

---

## 12. Variantes — à tester en Phase 3, jamais avant

Chacune est testée **isolément**, contre la v1 comme référence. Aucune n'entre en v1.

| ID | Variante | Hypothèse testée |
|----|----------|------------------|
| V1 | Cible fixe à 2 R au lieu de la liquidité opposée | La cible structurelle est-elle meilleure qu'un R fixe ? |
| V2 | Killzone New York AM activée (2 trades/jour) | Double l'échantillon — premier levier si le nombre de trades est insuffisant |
| V3 | Stop au breakeven à +1 R | Réduit-il la perte moyenne sans tuer l'espérance ? |
| V4 | Sortie partielle 50 % à 1 R | Idem, au prix d'une complexité d'exécution accrue |
| V5 | Conservation jusqu'à 11:30 ET (NY AM) au lieu de 05:00 | La suite du mouvement paie-t-elle le risque de portage ? |
| V6 | Filtre de qualité de récupération (clôture ≥ 25 % dans le range) | Élimine-t-il les faux rejets ? |

---

## 13. Limites connues et assumées

- **Pas de filtre d'actualité économique.** Non mécanisable en Pine sans flux externe. Traité par une
  désactivation manuelle de l'alerte les jours de FOMC / CPI (procédure Phase 7), et documenté comme
  angle mort résiduel.
- **`NQ1!` continu ≠ contrat tradable.** Les gaps de rollover polluent les statistiques (cas 12).
- **Échantillon limité par la profondeur d'historique** (`spec-trading.md` §5) — contrainte à lever
  avant de conclure quoi que ce soit sur la performance.
- **Une seule stratégie, un seul instrument, une seule session.** Aucune diversification : le drawdown
  attendu est celui d'un système mono-régime. C'est assumé pour une v1 dont l'objectif est la
  **preuve de correction**, pas le rendement.
