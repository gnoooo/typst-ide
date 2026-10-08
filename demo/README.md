# Demo : Génération de GIFs avec Webdriver
## Prérequis
### Via conteneur (recommandé)
Le pipeline complet tourne dans un conteneur Ubuntu 24.04 jetable (`demo/Dockerfile`) : il fournit `WebKitWebDriver` (requis par `tauri-driver`, absent des dépôts Arch) et reprend les versions épinglées du projet (Rust 1.98.1, Node 20.20.2, Tauri CLI 2.12.0). Docker seul est requis sur l'hôte.

```bash
cd demo
bash run-container.sh
```

### En natif (hors Arch, où WebKitWebDriver est disponible)
```bash
# Rust/Cargo (déjà requis pour le projet)
cargo install tauri-driver   # WebDriver pour Tauri
# Conversion video → GIF
sudo apt install ffmpeg   # Debian/Ubuntu
# WebKitWebDriver (paquet webkit2gtk-driver sur Debian/Ubuntu)
```

### Node.js
```bash
cd demo && npm install
```

## Utilisation
### Pipeline complet (build + record + convert)
```bash
cd demo
bash demo.sh
```

### Sauter le build (si le binaire release est déjà à jour)
```bash
bash demo.sh --skip-build
```

### Uniquement convertir les séquences d'images en gifs
```bash
bash demo.sh --gif-only
```

## Structure
```
demo/
├── package.json
├── wdio.conf.js              # configuration WebdriverIO + tauri-driver
├── Dockerfile                # image Ubuntu 24.04 (WebKitWebDriver, toolchain)
├── run-container.sh          # lance le pipeline dans le conteneur
├── run-in-container.sh       # étapes exécutées dans le conteneur
├── scripts/
│   ├── record.sh             # build release → lance les tests
│   └── convert.sh            # PNG sequences → GIFs optimisés
└── tests/
    ├── walkthrough1.test.js  # premier lancement de l'app (GIF)
    ├── walkthrough2.test.js  # saisie de texte + preview temps réel (GIF)
    ├── preview.test.js       # capture statique images/preview.png
    └── preview-popup.test.js # carnet de marqueurs (images/preview-popup.png)
```

Les scénarios `walkthrought*` produisent les GIFs `images/walkthrought*.gif` ;
les scénarios `preview*` exportent leur dernière frame en PNG statique dans
`images/` (voir `demo.sh`).

## Comment ça fonctionne
`demo.sh` va :
- Compiler le frontend (`npm run build`)
- Compiler le binaire Tauri en mode `release` (`cargo tauri build --no-bundle`), utile pour une application suffisamment optimisée et fluide
- Lancer Webdriver pour piloter l'app via les scripts de tests (demo)
- Assembler les PNG en GIF via `ffmpeg`

## Ajouter un nouveau scénario
Un helper est disponible pour faciliter la création de scénarios de démonstration.
Pour ajouter une nouvelle démo :

- Créer un fichier `demo/tests/mon-scenario.test.js` en suivant le même pattern :
  ```javascript
  const { createRecorder, waitForEditor } = require("../helpers");
  
  const shot = createRecorder("mon-scenario");
  
  describe("Mon scénario", () => {
    it("montre une fonctionnalité", async () => {
      await waitForEditor();
  
      await shot("initial");
  
      // interactions
      const btn = await $("#mon-bouton");
      await btn.click();
      await browser.pause(300);
  
      await shot("resultat");
    });
  });
  ```

- Utiliser `waitForEditor()` pour attendre que l'application soit prête.
- Utiliser `shot("nom")` pour capturer les étapes importantes.
- Ajouter de petites pauses (`browser.pause(...)`) si une animation doit être visible.
- Lancer les démos pour générer les captures avec WebdriverIO.
