# Inserting images

Simply paste an image (`Ctrl + V`) while the editor has focus: it is saved into the project's `images/` folder and the `#image(...)` code is inserted at the cursor position.

```typst
#image("images/photo.png", width: 60%)
```

Note:
- You can change the size with the `width` or `height` parameters.
- For more information: https://typst.app/docs/reference/visualize/image/

Other ways to insert an image:
- **Manage project files** button (^folder_managed^): Hover an image then choose **Insert**.
- **figure** modal from the `#` button: Search an image on your computer then insert the figure.