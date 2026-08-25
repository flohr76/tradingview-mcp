# Spécification — Système de trading automatisé

**Statut :** Phase 0 close · Phase 1 close (voir `strategy-killzone-sweep-v1.md`) · Phase 2 non démarrée
**Branche :** `claude/plan-trading-automatise-ona5tp`
**Dernière mise à jour :** 2026-08-25

---

## 1. Mandat

Construire un système capable de générer, transmettre et exécuter des ordres **sans intervention humaine
pendant la session**, sur un instrument unique, à partir d'une stratégie entièrement mécanique.

Ce que le système **fait** :

- calcule un signal déterministe sur clôture de barre ;
- transmet ce signal à un exécuteur via une alerte TradingView (webhook) ;
- l'exécuteur dimensionne, envoie l'ordre au broker avec stop et cible attachés, et réconcilie l'état ;
- journalise tout, et peut être arrêté à tout moment par un opérateur humain.

Ce que le système **ne fait pas** :

- il ne prend aucune décision discrétionnaire ;
- il n'utilise **aucun LLM dans la boucle d'exécution** (cf. `RESEARCH.md:70` — la latence de raisonnement
  d'un agent le rend structurellement inapte au temps réel). Claude intervient en conception, codage,
  backtest et audit ; jamais en décision de trade ;
- il ne passe pas d'ordre via le pont CDP / le panneau Trading de TradingView.

**Critère global de succès :** *« le système fait exactement ce que la spec dit, dans tous les cas testés,
je peux le prouver et je peux l'arrêter à tout moment. »* La performance se juge ensuite, sur échantillon
suffisant.

---

## 2. Décisions actées (Phase 0)

| ID | Décision | Valeur retenue | Motif |
|----|----------|----------------|-------|
| D-01 | Instrument | **NQ / MNQ (Nasdaq-100 futures)** — recherche sur `NQ1!`, exécution sur le micro `MNQ` front-month | Fit naturel des killzones ICT de `examples/pine/killzones.pine` ; le micro permet un risque unitaire faible |
| D-02 | Voie d'exécution | **Non arrêtée — démo d'abord** | Aucun blocage pour les Phases 0→4 ; choix requis avant la Phase 5 |
| D-03 | Risque par trade | **0,5 % du capital**, sizing dynamique sur la distance au stop | Standard pour une stratégie non validée en réel ; supporte ~20 pertes consécutives avant −10 % |
| D-04 | Plan TradingView | **Payant, webhooks disponibles** | Rend l'architecture A viable telle quelle |
| D-05 | Architecture | **A — Pine `strategy()` → alerte webhook → exécuteur → API broker** | Chemin supporté par TradingView ; le pont MCP reste un outil de développement, hors chemin critique |
| D-06 | Timeframe de signal | **M5** (validation croisée M15, cf. §5) | `killzones.pine` exige un intraday ≤ 1H ; M5 = compromis bruit / granularité de la récupération |

## 3. Décisions différées

| ID | Question ouverte | Échéance | Impact si non tranchée |
|----|------------------|----------|------------------------|
| D-07 | **Capital de travail** (montant) | Avant Phase 3 | Détermine si la règle 0,5 % est exploitable — voir §4, point bloquant |
| D-08 | Broker + API | Avant Phase 5 | Bloque l'écriture de l'exécuteur |
| D-09 | Hébergement de l'exécuteur (VPS) | Avant Phase 5 | Le poste local est inutilisable : les killzones tombent la nuit en UTC-10 |
| D-10 | Dépôt de l'exécuteur (fork vs dépôt séparé) | Avant Phase 5 | Recommandation : **dépôt séparé** (secrets, cycle de vie, périmètre upstream) |
| D-11 | Deep Backtesting disponible sur le plan ? | Avant Phase 3 | Conditionne la taille d'échantillon atteignable — voir §5 |

---

## 4. Point bloquant identifié : capital minimum implicite

La règle 0,5 % (D-03) et le contrat MNQ (D-01) se contraignent mutuellement.

```
MNQ : 1 point = 2 $ · 1 tick = 0,25 pt = 0,50 $
Distance de stop attendue (estimation, à mesurer en Phase 3) : 25 à 60 points
Risque par contrat                                           : 50 $ à 120 $
Capital requis pour que 1 contrat tienne dans 0,5 %          : 10 000 $ à 24 000 $
```

| Capital | Conséquence |
|---------|-------------|
| < 10 000 $ | La quasi-totalité des signaux est rejetée par le sizing (`skip_size`) — le système ne trade pas |
| 10 000 – 25 000 $ | Trades pris seulement quand le stop est serré ; échantillon biaisé vers les petits ranges |
| ≥ 25 000 $ | Règle 0,5 % exploitable sur 1 contrat, sizing dynamique réellement actif |

**Décision requise (D-07).** Trois issues acceptables si le capital est inférieur à ~25 000 $ :
(a) taille fixe 1 contrat en assumant un risque effectif de 0,5 à 1,2 % ; (b) relever le risque à 1 % ;
(c) changer pour un instrument à granularité continue (forex/CFD). **Ne pas** compenser en resserrant
artificiellement les stops : cela détruit la logique de la stratégie.

---

## 5. Risque de faisabilité : profondeur d'historique vs taille d'échantillon

Le gate de Phase 3 exige **≥ 100 trades**. Avec la règle « 1 trade par jour maximum » (v1) et un taux de
setup estimé à 30–50 %, cela représente **60 à 120 trades par an**, soit **~2 ans d'historique in-sample
+ 1 an out-of-sample**.

Or TradingView plafonne le nombre de barres historiques chargées selon le plan (ordre de grandeur : de
quelques milliers à ~20 000). Sur NQ en M5 (~276 barres par jour de bourse), 20 000 barres ≈ **70 jours**.
L'échantillon requis n'est pas atteignable en M5 par un backtest standard.

Leviers, par ordre de préférence :

1. **Deep Backtesting** (plans Premium et supérieurs) — à vérifier sur le plan réel (D-11) ;
2. valider la statistique en **M15** (~92 barres/jour → ~215 jours pour 20 000 barres) et réserver le M5
   à la vérification du timing d'entrée sur une fenêtre courte ;
3. augmenter la fréquence de signal — variante V2 de la spec stratégie (activer la killzone New York AM),
   à n'envisager **qu'après** validation de la v1, jamais comme réglage de confort.

Si aucun levier ne permet d'atteindre 100 trades, le gate de Phase 3 est abaissé explicitement et
la taille de position en Phase 7 est réduite en conséquence — la décision est écrite, pas implicite.

---

## 6. Architecture retenue

```
   Recherche / développement                     Production (24/7, hors poste local)
 ┌───────────────────────────────┐         ┌──────────────────────────────────────────┐
 │ Claude Code + tradingview-mcp │         │  Alerte de stratégie TradingView         │
 │  · pine_check / pine_analyze  │         │        │ webhook HTTPS + payload JSON     │
 │  · data_get_strategy_results  │         │        ▼                                 │
 │  · replay_* (validation)      │         │  Récepteur                               │
 │  · capture_screenshot         │         │   · HMAC + allowlist IP + anti-replay    │
 └───────────────┬───────────────┘         │   · idempotence par signal_id            │
                 │ produit                 │        ▼                                 │
                 ▼                         │  Routeur d'ordres                        │
        Pine strategy() ────alert()───────▶│   · sizing 0,5 % · garde-fous risque     │
                                           │   · entrée + STOP/CIBLE en bracket broker│
                                           │        ▼                                 │
                                           │  API Broker ◀──▶ Réconciliation d'état   │
                                           │        ▲                                 │
                                           │  Kill switch · heartbeat · journal audit │
                                           └──────────────────────────────────────────┘
```

Le pont MCP est **hors du chemin critique** : s'il tombe, la production continue.

---

## 7. Contraintes

### 7.1 Juridique et conditions d'utilisation

- Les CGU TradingView restreignent la collecte automatisée et le *non-display use* ; le disclaimer du dépôt
  (`README.md:378-383`) proscrit explicitement le trading automatisé fondé sur les données extraites via CDP.
  L'architecture A évite ce point en n'utilisant **que le mécanisme d'alerte officiel** de TradingView pour
  la production — la conformité de l'usage reste sous la responsabilité de l'utilisateur, à vérifier sur son plan.
- CGU du broker sur l'accès API automatisé. Clés API en droits *trading uniquement*, jamais de retrait.
- Compte propre exclusivement. Trader pour des tiers relèverait d'une activité réglementée : hors mandat.

### 7.2 Dépôt

- Développement sur `claude/plan-trading-automatise-ona5tp` ; **aucune PR upstream** pour la partie bot :
  `CONTRIBUTING.md:25` place « automated trading or order execution » hors périmètre, et les couches
  stratégie/bot doivent rester dans un fork ou un dépôt séparé.
- Pas de stockage ni d'export de données de marché dans le pont (hors périmètre déclaré).
- Conventions existantes si du code touche `src/` : ESM, injection `_deps` pour la testabilité,
  `npm run lint` et `npm run test:unit` verts, retours `{ success: … }`.
- `alert_create` (`src/core/alerts.js:44`) force `web_hook: null` et ne crée que des alertes **de prix** :
  l'alerte de stratégie sera créée manuellement dans l'UI (une fois), ou l'outil sera étendu dans le fork.

### 7.3 Technique

- Les APIs internes TradingView ne sont pas documentées et peuvent casser à toute mise à jour → jamais
  dans le chemin critique.
- Pine ne passe pas d'ordres : il n'émet que des alertes, dont la **livraison n'est pas garantie** →
  réconciliation périodique de l'état obligatoire côté exécuteur.
- Fuseaux et DST : les sessions sont ancrées sur `America/New_York` (déjà traité dans `killzones.pine`).
  Vu d'UTC-10, la killzone de Londres tombe à 20:00–23:00 (été) / 21:00–00:00 (hiver) → hébergement distant.
- `NQ1!` est un contrat continu : les gaps de rollover trimestriel faussent les statistiques et ne sont pas
  tradables tels quels. Les jours de rollover sont exclus des stats et documentés.

### 7.4 Sécurité

- Secrets en variables d'environnement ou gestionnaire de secrets, **jamais commités**.
- Webhook : secret partagé HMAC + allowlist des IP TradingView + HTTPS strict + rejet des requêtes rejouées.
- 2FA sur le compte broker. Journal d'audit inaltérable des ordres émis.

### 7.5 Risque

- Risque fixe 0,5 % par trade, 1 trade par jour maximum en v1.
- Perte journalière maximale : **1 %** du capital → coupure automatique jusqu'au lendemain.
- Ni moyenne à la baisse, ni martingale, ni ajout sur position perdante.
- **Le stop est posé côté broker en même temps que l'entrée** (bracket). Le bot peut mourir ; le stop doit survivre.
- Dead-man switch : perte du heartbeat > 5 min pendant une position ouverte → alerte opérateur.

---

## 8. Gates de phase

| Phase | Livrable | Gate — franchi si et seulement si |
|-------|----------|-----------------------------------|
| 0 · Cadrage | ce document | Toutes les décisions D-01→D-06 écrites ; les différées ont une échéance |
| 1 · Spec stratégie | `strategy-killzone-sweep-v1.md` | Chaque règle décidable par une machine ; les 12 cas de référence donnent une décision unique et non ambiguë |
| 2 · Pine v1 | `strategy()` compilée | 0 erreur de compilation, `pine_analyze` propre, payload JSON valide sur chaque type d'ordre |
| 3 · Backtest | rapport de performance | ≥ 100 trades (ou seuil abaissé par écrit, cf. §5) · PF > 1,3 **net** de coûts · DD max ≤ seuil D-07 · rentable en out-of-sample et sur ≥ 2 des 3 régimes testés · plateau de paramètres · absence de repainting démontrée |
| 4 · Replay | checklist des 12 cas | 20 signaux consécutifs conformes à la spec, zéro entrée non expliquée |
| 5 · Exécuteur | service + tests | Webhook rejoué 5× → 1 seul ordre · réconciliation < 60 s · kill switch < 5 s testé · 6 scénarios de panne verts · zéro secret en dépôt |
| 6 · Paper | journal démo | ≥ 4 semaines **et** ≥ 30 trades · slippage réel dans la tolérance · 0 position orpheline · 0 erreur non gérée |
| 7 · Réel | journal live | 4 semaines sans incident technique · limites de risque jamais dépassées · exercice de coupure réalisé · performance dans l'intervalle attendu |

Un gate non franchi renvoie à la phase précédente. **Aucun contournement par optimisation de paramètres.**

---

## 9. Journal des décisions

| Date | ID | Décision | Auteur |
|------|----|----------|--------|
| 2026-08-25 | D-01→D-06 | Cadrage initial : MNQ, risque 0,5 %, architecture A, M5, démo d'abord | Utilisateur |
| 2026-08-25 | — | Point bloquant capital minimum (§4) et contrainte d'historique (§5) portés au dossier | Claude |
