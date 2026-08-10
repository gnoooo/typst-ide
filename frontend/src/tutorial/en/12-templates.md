# Using templates

Templates are ready-to-use Typst projects: library, test files, images and fonts included.

Open the manager via **Edit** > **Manage templates**:

- ^note_add^ **New**: create a template with its library and test file;
- ^download^ **Instantiate**: copy the template into your current project (images and fonts included).

```typst
#import "lib.typ": *

#show: template.with(title: "My report")

= Content
```