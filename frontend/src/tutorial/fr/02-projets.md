# Créer et ouvrir un projet

Un **projet** est un dossier qui contient vos fichiers (`.typ` principal, images, sources, etc.). Être dans un environnement "projet" permet l'auto-sauvegarde, l'insertion d'images, la gestion des fichiers, les notes et les bibliographies.

Une façon de représenter cette infrastructure plus graphiquement serait :
```plaintext
├── images/      # images du document
├── main.typ     # document principal utilisé par Typst pour générer le PDF
└── sources.bib  # fichier représentant les sources et références d'un document
```

- Le bouton de sauvegarde de fichier **bleu clignotant** en haut à gauche (^file_save^) crée un nouveau projet :
  1. Une fenêtre s'ouvre.
  2. Entrez un nom.
  3. Choisissez un emplacement. 
  - Ce que vous avez écrit est conservé.
- Le bouton de dossier **orange clignotant** en haut à gauche (^folder_open^) ouvre un projet existant parmi votre historique.

Une fois le projet créé ou ouvert, l'auto-sauvegarde ainsi que d'autres fonctionnalités nécessitant un projet actif sont disponibles.

Raccourcis clavier :
- `Ctrl + Shift + N` : nouveau projet
- `Ctrl + Shift + O` : ouvrir un projet
