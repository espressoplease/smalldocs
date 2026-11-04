# Mobile document controls

At widths up to 768px, document actions share the existing 44px top menu with
the wordmark and navigation button. The action strip scrolls horizontally when
needed. The file-info area retains its Cloud controls above the document title.
Metadata remains available through the information icon.

Editing and comment pill groups open below the primary menu, inside its sticky
header. Their measured height remains part of anchor scrolling and reading
position preservation. Opening the navigation drawer makes both groups and
the primary document actions inert until the drawer closes.

The same button nodes and event handlers move between the mobile header and
their original desktop location when the viewport crosses the breakpoint.
Desktop structure, dimensions and styling remain unchanged. Loading and error
states also cover the controls after they move outside the document surface.
Reduced-motion preferences disable their reveal transitions.

## Verification

- All 2,285 Node tests passed.
- 38 focused browser checks passed across document actions, Cloud loading,
  mobile navigation, comment input sizing, sharing and renderer embeds.
- A further resize check covers an open comment-mode drawer crossing back to
  desktop, with the original working controls restored.
- Desktop geometry and screenshots matched the previous code exactly at
  769px, 900px and 1328px.
- Mobile read and comment layouts were visually inspected at 320px, 390px and
  768px. An old cached mobile shell upgraded to the new header and retained
  working copy, sharing and metadata controls.

## Existing test debt

Seven assertions in `test/document-navigation.spec.js` also fail against the
unchanged baseline commit `c2538594cc37fee23b1632fbe64aaccd726b9130`.
They expect removed footer links, former sidebar structure, the former desktop
toolbar position, old shared-tag counts, or automatically expanded tag groups.
Their baseline failures were reproduced in an isolated checkout. The focused
mobile navigation checks pass, including drawer focus, scrolling and resizing.
