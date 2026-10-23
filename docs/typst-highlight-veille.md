# Veille - Surlignage de syntaxe Typst (phase de recherche)

Objectif : recensement des conditions et contraintes exactes pour la réécriture
de la grammaire Monarch dans `frontend/src/js/typst-syntax.js`, d'après les
sources officielles. Ce document est la référence pour l'implémentation.
la spec finale vivra en commentaires dans `typst-syntax.js`.

## 1. Sources

| Source | Rôle | URL |
|---|---|---|
| Grammaire TextMate officielle | réf. des regex / begin-end des VS Code et du portage actuel | <https://raw.githubusercontent.com/typst/typst/main/tools/support/typst.tmLanguage.json> |
| Parseur officiel (branche main) | autorité sur les transitions de modes (newline, groupements, `;`) | <https://github.com/typst/typst/blob/main/crates/typst-syntax/src/parser.rs> |
| typst.app/docs/reference/syntax/ | modes, markup, math, commentaires, escapes, identifiants | (web) |
| typst.app/docs/reference/scripting/ | expressions, `#`, `;`, blocs, imbrication | (web) |

## 2. Modes et transitions (canoniques, parseur officiel)

Trois modes : **markup** (défaut), **math** (`$..$`), **code** (`#`).

- `#` (markup/math -> code) : `embedded_code_expr` entre en `SyntaxMode::Code,
  AtNewline::Stop` (parser.rs ~561). Le code redevient markup "après que
  l'expression est finie". `;` force la fin explicitement ("normal markup
  parsing resumes after the expression is finished... can forcibly be ended with a
  semicolon"). `#` suivi d'espace/fin = erreur parser (mais on colore le `#`).
- Newline et code : `AtNewline::Stop` pour un `#expr` (se termine à TOUTE
  newline sauf dans un groupement). `ContextualContinue` n'existe que pour les
  blocs `{ }` (continue si le token suivant est `else` ou `.`).
  -> une chaîne de méthode multi-ligne hors parenthèses est une erreur Typst.
  `#("a"\n .split()\n .join[..])` est légal car tout le monde est dans `(`.
- Groupements -> `AtNewline::Continue` (newlines transparentes) :
  `()` array/dict (parser.rs ~1079), arguments d'appel (~1188), paramètres de
  closure (~1251), déstructuring (~1334), bloc code `{ }` (~750, stop à `}`),
  bloc content `[ ]` (~761, mode **Markup**, stop à `]`), math (~229, stop à `$`).
- Bloc content dans le code : `[..]` passe en mode markup, `]` referme -> retour
  code si l'expression continue (`.`, `(`, `,`, `:`, opérateurs), sinon fin
  d'expression -> markup. `list([A], [B])` == `list[A][B]`.
- Pas d'espace entre une fonction et sa liste d'arguments : `#text (x)` = erreur
  ("there may not be any spaces before the argument list", ~1180) - la
  détection de fonction `#name(?=\[|\()` est donc correcte.
- Statements (`let`, `set`, `show`, `import`, `include`, `export`) après `#` :
  exigent `;` ou fin de ligne (erreur "semicolon or line break" sinon).
  `#let x = 1 texte` est une erreur, pas du markup. La grammaire TM reflète ça :
  blocs `begin (#)(let|set|show|context)` / `(#)(import|include|export)` avec
  `end: "\n|(;)|(?=])"`, blocs `if`/`for`/`while` avec `end: "\n|(?=])|(?<=}|])"`.

## 3. Conditions par construct

- **Commentaires** : `//` ligne, `/* ... */` bloc multi-lignes, présents dans
  les 3 modes (y compris math : `$/* c */$`). TM : `(?<!:)//` pour ne pas
  manger les `https://` - notre portage fait pareil via l'ordre des règles
  (lien avant commentaire), à conserver.
- **Escapes markup** : `\` + un de `\/[]{}#*_=~``$-.` ou `\u{hex}`, idem dans
  les strings (`\\ \" \n \r \t \u{..}`). `\` seul = saut de ligne.
- **Identifiants** : Unicode XID31, `_` autorisé en début, `_`/`-` en corps.
  lettres non-ASCII valides (`pi`, CJK). Regex TS : `[[:alpha:]_]` ~ `\p{L}` en
  JS, le portage actuel en `[A-Za-z]` est sous-approximatif (à decision :
  `u` flag Monarch, option `unicode: true`).
- **Strong/emphasis** : `*x*` / `_x_`, conditions de délimitation TM :
  `(^\*|\*$|(?<=\W|_)\*|\*(?=\W|_))` et ce sont des *états* (peuvent chevaucher
  une ligne, fin \n ou `(?=])` éventuelle), contenu = markup inclus.
- **Raw** : `` `x` `` inline, ```` ``` ````+ bloc (3+ backticks, même quantité
  pour fermer), TM n'a ce rule que dans markup (le doc dit aussi présent en
  code - extension souhaitable chez nous).
- **Math** : `$..$` depuis markup OU code, block-level si espaces
  `$ x^2 $`, multi-lignes autorisé (état, pas regex mono-ligne).
  le contenu math est stylé uniformément dans TM (`string.other.math`),
  seuls `$ ... $#expr$`?? - non : TM n'internalise RIEN dans math (pas même
  les `\^`), shorthands `$->$`, `$!=$` (`:name:` aussi dans math).
- **Strings** : uniquement en code, `".."` avec escapes, TM les liste dans
  `#constants` (inclus par `#code`) - et l'état `string` actuel du portage est
  correct sur ce point.
- **Labels/références** : `<name>` / `@name` avec `[alpha_][alnum_-]*`.
  labels dedié markup (le parseur : "labels can only be applied in markup
  mode"). TM le garde aussi en code.
- **Symbol shorthand** : `:([a-zA-Z0-9]+:)+` (markup), `~`, `---`, `--`, `-?`,
  `...` en markup.
- **Opérateurs code** (doc scripting) : `+ - * / == != < <= > >= in not in not
  and or = += -= *= /=`, `..` spread, `=>`, `:` param, `,` séparateur.
- **Paramètres nommés** dans `#arguments` TM : `ident(?=:)` -> token dédié
  (variable) non stylé chez nous aujourd'hui.

## 4. Contraintes Monarch (vérifiées dans le code monaco 0.53)

- Règle = `[regex, token]` ou `[regex, token, next]` : **une seule action**.
  pas de double `@pop` par règle, pas de lookbehind dynamique... mais :
- `switchTo` : remplace le haut de pile **sans** push (monarchLexer ~577).
- `@pop`, `@push`, `@popall`, `goBack: n` pour resoumer n caractères, et
  `@rematch` (re-joue la même position sous un autre état).
- **Match de longueur nulle autorisé si l'état change** (~693 : continue si
  `stackLen0 !== stack.depth || state !== stack.state`, sinon throw) -> un
  lookahead pur + `@pop` est utilisable ponctuellement (outil de secours).
- `includeLF: true` requis (les règles `\n` ne matchent jamais sinon - déjà
  compris par le portage actuel).
- `matchOnlyAtLineStart` pour les règles ancrées `^`.
- Pile max 100 niveaux, `unicode: true` ajoute le flag `u` aux regex (à tester
  si on veut `\p{L}`).
- Harnais de test déjà validé en node : `monarchCompile.js` s'importe sans DOM
 , `MonarchTokenizer` (monarchLexer.js) constructible avec 3 services stubbés
  (languageService.languageIdCodec, standaloneThemeService, configurationService
  `getValue`/`onDidChangeConfiguration`), puis `getInitialState()` +
  `tokenize(line, hasEOL, state)` ligne par ligne. Fallback si un service
  résiste : mini-boucle qui reproduit la sémantique Monarch (~40 lignes).

## 5. État des lieux du portage actuel (bugs intrinsèques)

1. `blockComment` : `/\*/` avant `\*/` -> `*/` jamais atteint, un bloc
   multi-lignes (ou contenant un `*` interne) avale le reste du fichier. Le
   système keytags/carnet (`frontend/src/js/comments/tokens.js`) s'appuie sur
   cet état -> symptômes partagés.
2. `#text(...)[Hello] some texts` : le `[` de `codeEOL` pousse `content`, le `]`
   repop vers `codeEOL` -> la suite de la ligne colorée en code.
3. Parenthèses multi-lignes après `#` : `codeEOL` pop au `\n` -> ligne suivante
   colorée comme markup alors que Typst continue le code dans `(`.
4. Math multi-lignes : un seul regex mono-ligne.
5. Raw bloc ```` ``` ```` : regex unique paresseuse, rendu partiel par ligne.
6. `[`/`]` traités comme "content" depuis le markup racine (en Typst un bloc
   content n'existe qu'en code, `[` isolé en markup est un caractère banal).

## 6. Décisions de conception (implémentation à venir)

- État visé : `root, codeEOL, code, content, group, string, math, rawBlock,
  blockComment` (+ éventuellement inline-strong/emph en états).
- Bug 2 : dans `codeEOL`, `[/\[/, 'bracket', '@switchTo:content']` - le
  `switchTo` remplace `codeEOL` par `content` sur la même pile (root->content).
  le `]` de content pop vers root = markup, les `#` internes re-poussent
  `codeEOL`, l'imbrication et le multi-lignes tiennent. Compétence assumée :
  `#let x = [a] + [b]` sur une ligne perdra sa coloration code sur les
  fragments après le premier `]` - cas rare, la version actuelle se trompe sur
  le texte courant commun.
- Bug 1 : ordonner `\*/` **avant** `\*` dans `blockComment`.
- Bug 3 : état `group` poussé sur `(` depuis codeEOL/code (inclut `@code`, pas
  de rule `\n`), `)` pop.
- Bug 4/5 : états `math` / `rawBlock` (copy TM : begin/end).
- Contrat à conserver : noms de tokens (`comment`, `string`, ...), état
  `blockComment` émettant des tokens `comment` ligne par ligne pour
  `tokens.js`, exports `registerTypstLanguage` / `getThemeName` pour editor.js.

## 7. Tests

Golden corpus dans `frontend/tests/typst-syntax.test.js` : extraits réels de la
doc Typst (commentaire multi-lignes, `#emph[Hello] \`, content `#{ ... }`,
imports de packages `@preview/...:0.1.0`, math multi-lignes, `$/* c */$`,
`#text(..) Hello`, destructuring parenthésé multi-ligne...). Exécution via le
harnais Monarch-in-node (§4). Puis `npm run test` (vitest) +
`./manage.sh check`, et revue visuelle dans l'app.
