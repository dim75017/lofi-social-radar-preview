# Architecture fonctionnelle

## Existant inspecté

Le dossier était un starter Next.js / TypeScript / vinext sans logique métier, schéma de données ni interface produit. Le dossier voisin concerne un autre produit et ne contient rien de réutilisable pour Social Intelligence. Le design de référence provient donc du Radar YouTube / Spotify live : fond nocturne `#07080d`, sidebar de 238 px, panneaux navy, cartes de 16 px, titres Sora, corps Inter et navigation par emojis.

## Tranche V1 livrée

```text
🔥 Tendance sourcée
  → ✨ Idée éditable
  → 🔒 score initial + explication + version figés
  → ⏳ décision humaine
       → ✅ validation → 📝 brief
       → ❌ refus motivé → ↩ restauration possible
  → 📈 résultat réel (prochaine tranche)
```

Valider ne planifie jamais automatiquement une idée. Le passage en Roadmap restera une action distincte.

## Architecture cible

```text
Interface Radar
  → routes API authentifiées
  → services métier
     TrendService · IdeaService · DecisionService · TrackingService
     ScoringEngine · BriefService
  → repository D1 aujourd’hui, PostgreSQL demain
  → journal d’audit · connecteurs · tâches asynchrones
```

La V1 utilise D1 derrière des routes structurées. Les mutations combinées utilisent des transactions `batch`, une version de ligne protège les décisions concurrentes et le journal des décisions est append-only.

## Données actuellement persistées

- `trends` : source, date de détection, vélocité, maturité, saturation, fit/risque marque, recommandation et explication.
- `ideas` : concept, objectif, plateforme, format, personnage, hook, effort, statut et scores.
- `briefs` : objectif, message, variantes de hook, storyboard, assets et critère de succès.
- `decision_events` : action, état avant/après, acteur, motif et snapshot immuable.

La prochaine évolution ajoutera les observations temporelles, versions d’idées, suivi de production, publications et snapshots de performance.

## Scoring V1

Le score est volontairement explicable :

- 30 % cohérence de marque ;
- 25 % timing ;
- 20 % qualité des preuves ;
- 15 % adéquation stratégique ;
- 10 % faisabilité ;
- pénalités de risque de marque et de saturation.

Sans historique suffisant, l’interface affiche « Données insuffisantes ». Le score ne doit jamais être présenté comme une causalité ou une garantie de performance.

## Phases suivantes

1. YouTube historique : import et OAuth propriétaire, bibliothèque de contenus et cohortes par âge.
2. Community Inbox : imports de commentaires, priorisation, réponses suggérées et validation humaine.
3. Calendrier et expérimentation : Roadmap explicite, variantes, seuils de décision et mesure.
4. Learning Engine : résultats réels, calibration des scores, comparaison IA / humain / résultat.
5. Connecteurs supplémentaires uniquement après validation des droits et permissions.
