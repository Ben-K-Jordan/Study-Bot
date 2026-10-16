/**
 * Content for the demo account created by scripts/seed-demo.ts: lecture
 * notes, question banks, flashcard decks, study guides and a chat history.
 *
 * Everything here is original writing for demo purposes. Dates are day
 * offsets from "today" in the demo user's timezone plus a local wall-clock
 * time, so the seed can place them relative to the day it runs.
 */

export type ErrorType = "MISCONCEPTION" | "PROCEDURE" | "CARELESS" | "MEMORY" | "UNKNOWN";

/** [day offset from today, "HH:MM" local time] */
export type When = [number, string];

export interface DemoObjective {
  /** Short code used in this file to refer to the objective. */
  code: string;
  /** Title as the student typed it; the app derives the objective id from it. */
  title: string;
  /** A solid answer from memory (pretest and review questions). */
  recall: string;
  /** A shaky answer from memory. */
  weak: string;
}

export interface DemoQuestion {
  key: string;
  obj: string;
  text: string;
  difficulty: number;
  /** Multiple choice: the app grades the choice and writes the error log itself. */
  mcq?: { choices: string[]; correct: number; trap: number; rationales: string[] };
  model: string;
  points: string[];
  good: string;
  bad: string;
  partial?: string;
  errorType: ErrorType;
  /** The correction rule the student writes after a miss. */
  rule: string;
  /** AI-written explanation stored with the feedback for a miss. */
  explain: string;
}

export interface DemoDoc {
  file: string;
  title: string;
  uploaded: When;
  summary: string;
  questions: string[];
  body: string;
}

export interface DemoCourse {
  name: string;
  exam: string;
  examOffset: number;
  objectives: DemoObjective[];
  docs: DemoDoc[];
  questions: DemoQuestion[];
}

// ---------------------------------------------------------------------------
// INFO 1300: Web Design
// ---------------------------------------------------------------------------

const INFO1300_DOCS: DemoDoc[] = [
  {
    file: "info1300-lecture-14-specificity-and-box-model.md",
    title: "Lecture 14: Specificity, the cascade, and the box model",
    uploaded: [-13, "21:40"],
    summary:
      "How the cascade resolves conflicting rules, how to score selector specificity column by column, and how padding, border, margin and box-sizing determine an element's rendered size.",
    questions: [
      "Why does one ID selector beat any number of class selectors?",
      "When does source order decide which rule wins?",
      "How wide is a 300px box with 20px padding under content-box and border-box?",
    ],
    body: `# Lecture 14: Specificity, the cascade, and the box model

## How the CSS cascade picks a winner

When two CSS rules set the same property on the same element, the browser resolves the conflict in a fixed order: origin and importance first, then specificity, then source order. A rule later in the stylesheet only wins when the competing rules tie on everything before it.

## Calculating specificity

CSS specificity is a three-part score written as (IDs, classes, types). Count each ID selector in the first column; each class, attribute selector and pseudo-class in the second; and each type selector and pseudo-element in the third. Compare the columns left to right. The first column that differs decides the winner, so #nav a (1,0,1) beats .menu .item .link (0,3,0) even though the second selector is longer. There is no carrying between columns: eleven classes never add up to an ID.

The universal selector and the combinators (child, sibling and descendant) add nothing. Inline style attributes beat any selector in the stylesheet, and !important beats both, which is why it is reserved for utility overrides rather than everyday styling.

:is() and :not() take the specificity of their most specific argument. :where() always contributes zero, which makes it useful for low-priority defaults that are easy to override.

## Worked example

Given p.intro { color: gray } and #story p { color: black }, a paragraph with class intro inside #story renders black. The first selector scores (0,1,1); the second scores (1,0,1). The ID column decides before the class column is ever compared.

## The box model

Every element is a rectangular box made of content, padding, border and margin. With the default box-sizing: content-box, width sets only the content area, so a 300px box with 20px padding and a 2px border takes up 344px horizontally. With box-sizing: border-box, width includes padding and border, and the content area shrinks to fit. Most projects set border-box on every element so that declared widths match what appears on screen.

Vertical margins between block elements collapse: two stacked paragraphs with 24px and 16px margins end up 24px apart, not 40px. Padding and borders never collapse, and margins do not collapse inside flex or grid containers.
`,
  },
  {
    file: "info1300-lecture-16-flexbox-and-grid.md",
    title: "Lecture 16: Flexbox and grid layout",
    uploaded: [-13, "21:42"],
    summary:
      "Flexbox main and cross axes, alignment with justify-content and align-items, the flex shorthand, and two-dimensional page layouts with named grid template areas.",
    questions: [
      "Which property centers flex items along the cross axis?",
      "What does flex: 1 expand to?",
      "Why does an L-shaped grid area invalidate grid-template-areas?",
    ],
    body: `# Lecture 16: Flexbox and grid layout

## Flexbox axes

A flex container lays out its children along a main axis set by flex-direction (row by default) and a cross axis perpendicular to it. justify-content distributes space along the main axis: flex-start, center, space-between, space-around and space-evenly. align-items positions items on the cross axis: stretch (the default), flex-start, center and baseline. When flex-direction is column, the axes swap, so justify-content centers vertically and align-items centers horizontally.

To center one element both ways, make the parent a flex container and set justify-content: center and align-items: center. align-self overrides align-items for a single item.

## Growing and shrinking

flex: 1 is shorthand for flex-grow: 1, flex-shrink: 1 and flex-basis: 0%. Items with flex: 1 share free space equally regardless of their content. gap adds space between items without adding it to the outer edges.

## Grid template areas

CSS grid lays out items in two dimensions. grid-template-areas lets you name regions with strings, one string per row:

.page {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
}

Each child then claims a region with grid-area: header, grid-area: main, and so on. Every string must have the same number of cells, and each named area must form a rectangle. An L-shaped area makes the whole declaration invalid, and the browser ignores it. A period (.) marks an empty cell.

Areas make responsive layouts readable. Inside a media query you can redefine grid-template-areas, for example stacking "header" "main" "sidebar" "footer" in a single column, without touching the HTML order.

## Flexbox or grid?

Use flexbox when content flows in one direction and items should size themselves, like a nav bar or a row of buttons. Use grid when you are placing items into rows and columns at the same time, like a page layout or a photo gallery.
`,
  },
  {
    file: "info1300-lecture-18-responsive-images.md",
    title: "Lecture 18: Responsive images and media queries",
    uploaded: [-5, "22:15"],
    summary:
      "Serving the right image file with srcset and sizes, density descriptors for fixed-size images, art direction with the picture element, and mobile-first media queries.",
    questions: [
      "What does the w descriptor in srcset describe?",
      "What happens if an img with w descriptors has no sizes attribute?",
      "When do you need picture instead of srcset alone?",
    ],
    body: `# Lecture 18: Responsive images and media queries

## Why srcset

A single 2400px hero image wastes bandwidth on a phone, and a 600px image looks blurry on a large high-density screen. The srcset attribute lists candidate files and lets the browser choose.

## Width descriptors and sizes

<img src="hero-800.jpg"
     srcset="hero-400.jpg 400w, hero-800.jpg 800w, hero-1600.jpg 1600w"
     sizes="(max-width: 600px) 100vw, 50vw"
     alt="Students on the Arts Quad">

The w descriptor states each file's intrinsic width in pixels. The sizes attribute tells the browser how wide the image will be displayed, because the browser picks an image before CSS has loaded. In the example, the image fills the viewport on screens up to 600px and half the viewport above that. The browser multiplies the slot width by the device pixel ratio and picks the smallest candidate that covers it. If you use w descriptors and leave out sizes, the browser assumes 100vw and often downloads a much larger file than needed.

## Density descriptors

For images shown at a fixed size, like a 64px avatar, density descriptors are simpler: srcset="avatar-64.png 1x, avatar-128.png 2x". Do not mix x and w descriptors in the same srcset.

## Art direction with picture

srcset only switches between resolutions of the same image. When you need a different crop on small screens, use picture with source elements that carry a media attribute. The browser uses the first source whose media query matches, and the img inside is the fallback and carries the alt text.

## Media queries

A media query applies rules only when a condition is true:

@media (min-width: 768px) {
  .gallery { grid-template-columns: repeat(3, 1fr); }
}

Mobile-first stylesheets write the base styles for small screens and add min-width queries as space grows. Choose breakpoints where the content breaks, not at the widths of particular phones. The viewport meta tag, <meta name="viewport" content="width=device-width, initial-scale=1">, is required, or mobile browsers render the page at a desktop width and scale it down.
`,
  },
];

const INFO1300_OBJECTIVES: DemoObjective[] = [
  {
    code: "S",
    title: "CSS specificity",
    recall:
      "Specificity is scored as IDs, classes, types. You compare the columns left to right and the first difference wins. Source order only matters on a tie.",
    weak: "More specific selectors win. I think longer selectors count as more specific? Not totally sure how IDs compare.",
  },
  {
    code: "B",
    title: "Box model",
    recall:
      "Content, padding, border, margin from the inside out. With content-box the width is just the content; border-box includes padding and border.",
    weak: "Every element is a box with padding and margin around it. Not sure what box-sizing changes.",
  },
  {
    code: "F",
    title: "Flexbox alignment",
    recall:
      "justify-content works on the main axis and align-items on the cross axis. With flex-direction column they swap directions.",
    weak: "justify-content centers horizontally and align-items centers vertically, I think always.",
  },
  {
    code: "G",
    title: "Grid template areas",
    recall:
      "You name regions on the container with grid-template-areas strings, one per row, and children claim them with grid-area. Areas have to be rectangles.",
    weak: "grid-template-areas lets you name parts of the grid. I don't remember the exact syntax.",
  },
  {
    code: "R",
    title: "Responsive images and srcset",
    recall:
      "srcset lists files with their real widths (w) and sizes says how wide the slot will be, so the browser can pick the smallest file that covers it.",
    weak: "srcset gives the browser different image sizes for different screens. sizes sets how big the image shows up?",
  },
  {
    code: "M",
    title: "Media queries",
    recall:
      "Media queries apply CSS only when a condition is true. Mobile first means base styles for small screens, then min-width queries as the screen grows.",
    weak: "@media lets you change styles for phones. You use max-width for mobile I think.",
  },
];

const INFO1300_QUESTIONS: DemoQuestion[] = [
  // CSS specificity
  {
    key: "s1",
    obj: "S",
    difficulty: 2,
    text: "A link sits inside <nav id=\"main\"> and has the class active. Which rule sets its color: #main a { color: navy } or .nav .links a.active { color: red }?",
    mcq: {
      choices: [
        "#main a, because one ID outranks any number of classes",
        ".nav .links a.active, because it has more selectors",
        "Whichever rule appears later in the stylesheet",
        "Neither: the selectors tie and the browser default applies",
      ],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. (1,0,1) beats (0,3,1) because the ID column is compared first.",
        "Length doesn't matter. Three classes, (0,3,1), still lose to one ID.",
        "Source order only breaks ties, and these selectors don't tie.",
        "The scores differ in the ID column, so one rule wins outright.",
      ],
    },
    model: "#main a wins. Its specificity is (1,0,1); the other rule is (0,3,1), and the ID column is compared first.",
    points: ["#main a is (1,0,1)", ".nav .links a.active is (0,3,1)", "the first column that differs decides"],
    good: "#main a wins because it has an ID, and the ID column is compared before classes.",
    bad: "The red one, because it has more selectors in it.",
    errorType: "MISCONCEPTION",
    rule: "Compare specificity column by column. One ID beats any number of classes.",
    explain:
      "Specificity is compared column by column from the left. #main a scores (1,0,1) and .nav .links a.active scores (0,3,1). The first column already differs, so the class count never comes into play.",
  },
  {
    key: "s2",
    obj: "S",
    difficulty: 3,
    text: "Write the specificity of #story p.intro::first-line and explain how you counted it.",
    model: "(1,1,2): one ID (#story), one class (.intro), and two in the type column (p and the ::first-line pseudo-element).",
    points: ["#story counts as 1 ID", ".intro counts as 1 class", "p and ::first-line both count as types"],
    good: "(1,1,2). #story is the ID, .intro is the class, and p plus the ::first-line pseudo-element go in the type column.",
    bad: "(1,1,1). One ID, one class, one element. Pseudo-elements don't count.",
    errorType: "MEMORY",
    rule: "Pseudo-elements like ::first-line count in the type column, the same as element selectors.",
    explain:
      "The type column counts element selectors and pseudo-elements. p and ::first-line are both in that column, so the score is (1,1,2), not (1,1,1).",
  },
  {
    key: "s3",
    obj: "S",
    difficulty: 3,
    text: "Why doesn't .card .title override #sidebar h2, even though the .card rule comes later in the file?",
    model: "Source order only breaks ties. #sidebar h2 is (1,0,1) and .card .title is (0,2,0), so the ID rule wins wherever it appears.",
    points: ["source order only matters when specificity ties", "#sidebar h2 is (1,0,1)", ".card .title is (0,2,0)"],
    good: "Because the later rule only wins on a tie. #sidebar h2 has an ID so it's (1,0,1) against (0,2,0).",
    bad: "Later rules always win in CSS, so the class name must be misspelled or the file is cached.",
    partial: "Something about IDs being stronger, but I thought the later rule should still win.",
    errorType: "MISCONCEPTION",
    rule: "Source order only breaks ties. Compare specificity first; here the ID column decides.",
    explain:
      "The cascade checks specificity before source order. #sidebar h2 scores (1,0,1) and .card .title scores (0,2,0). They don't tie, so it doesn't matter which rule comes later in the file.",
  },
  {
    key: "s4",
    obj: "S",
    difficulty: 4,
    text: "What is the specificity of :where(#hero) .button?",
    mcq: {
      choices: ["(0,1,0)", "(1,1,0)", "(0,2,0)", "(1,0,0)"],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. :where() always adds zero, so only .button counts.",
        "This treats :where() like :is(), which takes its argument's specificity.",
        ":where() is not a class; it contributes nothing.",
        "The ID inside :where() is discarded, and .button still counts.",
      ],
    },
    model: "(0,1,0). :where() contributes zero specificity, so only the .button class counts.",
    points: [":where() always adds zero", ".button adds one class"],
    good: ":where() adds nothing, so it's just .button: (0,1,0).",
    bad: "(1,1,0), the ID inside still counts.",
    errorType: "MISCONCEPTION",
    rule: ":where() always contributes zero; :is() and :not() take their most specific argument.",
    explain:
      ":where() was designed for low-priority defaults: whatever is inside it contributes zero. Only .button counts, so the score is (0,1,0). :is(#hero) .button would be (1,1,0).",
  },
  {
    key: "s5",
    obj: "S",
    difficulty: 3,
    text: "A rule chains eleven class selectors. Does it beat a rule with a single ID selector? Explain.",
    model: "No. Specificity columns never carry over, so (0,11,0) still loses to (1,0,0).",
    points: ["columns don't carry", "(0,11,0) loses to (1,0,0)"],
    good: "No. Eleven classes is (0,11,0) and the columns don't carry, so (1,0,0) still wins.",
    bad: "Yes. Eleven classes add up to more than ten, which carries over into the ID column.",
    errorType: "MISCONCEPTION",
    rule: "Specificity columns never carry. Any number of classes loses to one ID.",
    explain:
      "Specificity is not a base-10 number. Each column is compared separately, so no number of classes can reach the ID column. (1,0,0) beats (0,11,0).",
  },
  // Box model
  {
    key: "b1",
    obj: "B",
    difficulty: 2,
    text: "A div has width: 300px, padding: 20px, a 2px border and the default box-sizing. How wide is it on screen?",
    mcq: {
      choices: ["344px", "300px", "340px", "322px"],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. 300 + 20 + 20 + 2 + 2 = 344.",
        "That would be true with border-box, not the default content-box.",
        "This leaves out the border on both sides.",
        "This counts padding and border on one side only.",
      ],
    },
    model: "344px: the 300px content plus 20px padding and 2px border on each side.",
    points: ["content-box is the default", "add padding and border on both sides"],
    good: "344px, because content-box adds the padding and border on both sides to the 300.",
    bad: "300px, that's the width you set.",
    errorType: "MISCONCEPTION",
    rule: "With content-box, rendered width = width + left and right padding + left and right border.",
    explain:
      "The default box-sizing is content-box, so width only sets the content area. Padding and border are added on both sides: 300 + 40 + 4 = 344px.",
  },
  {
    key: "b2",
    obj: "B",
    difficulty: 2,
    text: "What changes when you set box-sizing: border-box on an element with a declared width?",
    model: "The declared width now includes padding and border, so the box renders at exactly that width and the content area shrinks.",
    points: ["width includes padding and border", "content area shrinks"],
    good: "The width includes the padding and border now, so the box is exactly the width you set and the content gets smaller.",
    bad: "It puts the border outside the box so the element gets bigger.",
    errorType: "MISCONCEPTION",
    rule: "border-box means width includes padding and border; the content area shrinks to fit.",
    explain:
      "border-box moves padding and border inside the declared width. The element's outer size matches the CSS, and the content area gets whatever is left.",
  },
  {
    key: "b3",
    obj: "B",
    difficulty: 3,
    text: "Two stacked paragraphs have margin-bottom: 24px and margin-top: 16px. How far apart are they, and why?",
    model: "24px. Adjacent vertical margins between blocks collapse to the larger of the two.",
    points: ["vertical margins collapse", "the larger margin wins"],
    good: "24px. The vertical margins collapse and you get the bigger one.",
    bad: "40px, the two margins add up.",
    partial: "They collapse, so maybe 16px?",
    errorType: "MISCONCEPTION",
    rule: "Adjacent vertical margins collapse to the larger value; they don't add.",
    explain:
      "Vertical margins between adjacent block elements collapse into one margin equal to the larger of the two, so the gap is 24px. This doesn't happen inside flex or grid containers.",
  },
  {
    key: "b4",
    obj: "B",
    difficulty: 1,
    text: "Name the four layers of the box model from the inside out.",
    model: "Content, padding, border, margin.",
    points: ["content", "padding", "border", "margin"],
    good: "Content, padding, border, margin.",
    bad: "Content, border, padding, margin.",
    errorType: "CARELESS",
    rule: "Padding sits inside the border; margin sits outside it.",
    explain: "Padding is the space between the content and the border. Margin is outside the border and separates the box from its neighbors.",
  },
  // Flexbox alignment
  {
    key: "f1",
    obj: "F",
    difficulty: 2,
    text: "In a flex container with flex-direction: column, which property centers the children horizontally?",
    mcq: {
      choices: ["align-items: center", "justify-content: center", "text-align: center", "align-content: center"],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. In a column the cross axis is horizontal, and align-items works on the cross axis.",
        "justify-content works on the main axis, which is vertical in a column.",
        "text-align centers inline content, not flex items.",
        "align-content spaces wrapped lines, not individual items.",
      ],
    },
    model: "align-items: center. With flex-direction: column, the cross axis is horizontal.",
    points: ["column makes the main axis vertical", "align-items works on the cross axis"],
    good: "align-items: center, because in a column the cross axis is the horizontal one.",
    bad: "justify-content: center.",
    errorType: "MISCONCEPTION",
    rule: "justify-content follows the main axis and align-items the cross axis; flex-direction: column swaps them.",
    explain: "flex-direction: column makes the main axis vertical, so the horizontal direction is the cross axis, which align-items controls.",
  },
  {
    key: "f2",
    obj: "F",
    difficulty: 1,
    text: "How do you center a single child both horizontally and vertically inside its parent with flexbox?",
    model: "Set the parent to display: flex with justify-content: center and align-items: center.",
    points: ["display: flex on the parent", "justify-content: center", "align-items: center"],
    good: "Parent gets display: flex, justify-content: center and align-items: center.",
    bad: "Put margin: auto and text-align: center on the child.",
    errorType: "PROCEDURE",
    rule: "Center both ways with display: flex plus justify-content: center and align-items: center on the parent.",
    explain: "Both alignment properties go on the flex container. justify-content handles the main axis and align-items the cross axis.",
  },
  {
    key: "f3",
    obj: "F",
    difficulty: 3,
    text: "What does flex: 1 expand to, and what happens when three siblings all have it?",
    model: "flex-grow: 1, flex-shrink: 1, flex-basis: 0%. The three items split the free space equally regardless of their content.",
    points: ["grow 1, shrink 1, basis 0%", "equal shares of free space"],
    good: "flex-grow 1, flex-shrink 1, flex-basis 0%, so all three take equal widths no matter what's in them.",
    bad: "It means flex-grow: 1 only, so bigger items stay bigger.",
    errorType: "MEMORY",
    rule: "flex: 1 is grow 1, shrink 1, basis 0%, which splits space equally.",
    explain: "Because flex-basis is 0%, no item starts with a content-based size, so the free space is split evenly between the three.",
  },
  {
    key: "f4",
    obj: "F",
    difficulty: 2,
    text: "Which justify-content value puts equal space between items but none at the outer edges?",
    mcq: {
      choices: ["space-between", "space-around", "space-evenly", "center"],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. space-between puts the first and last items flush with the edges.",
        "space-around adds half-size gaps at the edges.",
        "space-evenly makes the edge gaps the same as the gaps between items.",
        "center groups the items in the middle with no space between them.",
      ],
    },
    model: "space-between.",
    points: ["first and last items touch the edges"],
    good: "space-between.",
    bad: "space-around.",
    errorType: "CARELESS",
    rule: "space-between: no edge space; space-around: half gaps at the edges; space-evenly: equal everywhere.",
    explain: "space-between pins the first and last items to the container edges and spreads the rest of the space between items.",
  },
  // Grid template areas
  {
    key: "g1",
    obj: "G",
    difficulty: 3,
    text: "Write grid-template-areas for a two-column layout with a header across the top, a sidebar and main area in the middle, and a footer across the bottom.",
    model: "grid-template-areas: \"header header\" \"sidebar main\" \"footer footer\";",
    points: ["one string per row", "two cells per row", "repeat a name to span both columns"],
    good: "\"header header\" \"sidebar main\" \"footer footer\"",
    bad: "\"header\" \"sidebar main\" \"footer\"",
    errorType: "PROCEDURE",
    rule: "Every row string needs the same number of cells; repeat a name to span columns.",
    explain:
      "Each string is one row, and every row must have the same number of cells. To make the header and footer span both columns, repeat the name: \"header header\".",
  },
  {
    key: "g2",
    obj: "G",
    difficulty: 3,
    text: "What happens if a named area in grid-template-areas forms an L shape?",
    mcq: {
      choices: [
        "The whole declaration is invalid and ignored",
        "The browser fills the L shape anyway",
        "Only the L-shaped area is ignored",
        "The area becomes the smallest rectangle around it",
      ],
      correct: 0,
      trap: 2,
      rationales: [
        "Correct. Named areas must be rectangles, or the whole property is invalid.",
        "Grid areas can only be rectangles.",
        "The browser drops the entire declaration, not just one area.",
        "There is no automatic correction to a bounding rectangle.",
      ],
    },
    model: "The whole grid-template-areas declaration is invalid and the browser ignores it.",
    points: ["areas must be rectangles", "the entire declaration is dropped"],
    good: "The whole declaration becomes invalid, so none of the areas apply.",
    bad: "Only that area is ignored and the rest still work.",
    errorType: "MISCONCEPTION",
    rule: "A non-rectangular area invalidates the entire grid-template-areas declaration.",
    explain:
      "Named grid areas must be rectangles. If any area isn't, the browser treats the whole grid-template-areas value as invalid and ignores it, so every area falls back to auto-placement.",
  },
  {
    key: "g3",
    obj: "G",
    difficulty: 2,
    text: "How does a child element claim a named region of the grid?",
    model: "With grid-area set to the region's name, for example grid-area: sidebar.",
    points: ["grid-area on the child", "value is the area name"],
    good: "Set grid-area on the child to the name, like grid-area: sidebar.",
    bad: "Put grid-template-areas on the child with its name.",
    errorType: "PROCEDURE",
    rule: "grid-template-areas goes on the container; children claim a region with grid-area.",
    explain: "The container defines the named regions. Each child opts into one with grid-area and the area's name.",
  },
  {
    key: "g4",
    obj: "G",
    difficulty: 2,
    text: "What does a period (.) mean inside a grid-template-areas string?",
    model: "An empty cell that no named area occupies.",
    points: ["empty cell"],
    good: "It's an empty cell with no area in it.",
    bad: "It ends the row, like a semicolon.",
    partial: "Something like a placeholder?",
    errorType: "MEMORY",
    rule: "A period in grid-template-areas marks an empty cell.",
    explain: "Periods fill cells that belong to no named area. Several periods in a row are several empty cells.",
  },
  {
    key: "g5",
    obj: "G",
    difficulty: 3,
    text: "How can you move the sidebar below the main content on small screens without changing the HTML?",
    model: "Redefine grid-template-areas inside a media query so the rows stack: \"header\" \"main\" \"sidebar\" \"footer\" with a single column.",
    points: ["media query", "redefine grid-template-areas", "HTML order stays the same"],
    good: "Inside a media query, change grid-template-areas to one column: header, main, sidebar, footer.",
    bad: "Move the sidebar div after main in the HTML.",
    errorType: "PROCEDURE",
    rule: "Redefine grid-template-areas in a media query; the HTML order stays the same.",
    explain: "Areas decouple visual placement from source order. Redefining the template in a media query moves regions without touching the markup.",
  },
  {
    key: "g6",
    obj: "G",
    difficulty: 3,
    text: "Can two rows in grid-template-areas have different numbers of cells?",
    model: "No. Each string is a row and every row must have the same number of cells, or the declaration is invalid.",
    points: ["same number of cells in every row", "otherwise invalid"],
    good: "No, every row string needs the same number of cells or it's invalid.",
    bad: "Yes, the grid fills the short rows with empty cells.",
    errorType: "MISCONCEPTION",
    rule: "All rows in grid-template-areas must have the same number of cells.",
    explain: "Unlike auto-placement, grid-template-areas does not pad short rows. Mismatched rows make the whole value invalid.",
  },
  {
    key: "g7",
    obj: "G",
    difficulty: 2,
    text: "In a two-column grid, which row string makes main span both columns?",
    mcq: {
      choices: ["\"main main\"", "\"main .\"", "\"main\"", "\"main span 2\""],
      correct: 0,
      trap: 2,
      rationales: [
        "Correct. Repeating the name across both cells spans the row.",
        "This puts main in the first column and leaves the second empty.",
        "A one-cell row doesn't match a two-column grid, so the declaration is invalid.",
        "span is not valid inside grid-template-areas strings.",
      ],
    },
    model: "\"main main\": repeat the name in every cell the area should cover.",
    points: ["repeat the area name"],
    good: "\"main main\", you repeat the name for each column.",
    bad: "\"main\", one name for the whole row.",
    errorType: "PROCEDURE",
    rule: "To span columns, repeat the area name in each cell.",
    explain: "An area covers every cell that carries its name. A two-column row needs two cells, so main appears twice.",
  },
  // Responsive images and srcset
  {
    key: "r1",
    obj: "R",
    difficulty: 2,
    text: "What does the w descriptor in srcset=\"hero-800.jpg 800w\" tell the browser?",
    model: "The file's intrinsic width: hero-800.jpg is 800 pixels wide.",
    points: ["intrinsic width of the file", "not the display width"],
    good: "That the file itself is 800 pixels wide.",
    bad: "That the image should be displayed 800px wide.",
    errorType: "MISCONCEPTION",
    rule: "w states the file's real pixel width; display width comes from sizes and CSS.",
    explain: "Width descriptors describe the candidate files, not the layout. The browser combines them with sizes and the pixel ratio to pick a file.",
  },
  {
    key: "r2",
    obj: "R",
    difficulty: 3,
    text: "Why does an img that uses w descriptors need a sizes attribute?",
    model: "The browser chooses a file before CSS loads, so sizes tells it how wide the image slot will be. Without sizes it assumes 100vw.",
    points: ["the choice happens before CSS loads", "sizes describes the slot width", "default is 100vw"],
    good: "Because the browser picks the file before it knows the CSS, so sizes tells it the slot width. Without it, it assumes 100vw.",
    bad: "sizes sets the displayed width of the image, like CSS width.",
    partial: "So the browser knows which file to pick? Not sure what happens without it.",
    errorType: "MISCONCEPTION",
    rule: "sizes is a hint about slot width for choosing a file; it doesn't style the image. Without it the browser assumes 100vw.",
    explain:
      "Image selection happens during HTML parsing, before layout is known. sizes gives the browser the slot width up front. It doesn't change how wide the image renders; CSS still does that.",
  },
  {
    key: "r3",
    obj: "R",
    difficulty: 4,
    text: "With sizes=\"(max-width: 600px) 100vw, 50vw\", a laptop window is 1200px wide at 2x density. How many device pixels wide is the slot the browser plans for?",
    mcq: {
      choices: ["1200", "600", "2400", "800"],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. 50vw of 1200px is 600 CSS pixels, times 2 for the density.",
        "600 is the slot in CSS pixels; the browser also multiplies by the pixel ratio.",
        "This uses 100vw, but the window is wider than 600px.",
        "There is no 800px rule in this sizes value.",
      ],
    },
    model: "1200: the slot is 50vw = 600 CSS pixels, and 600 x 2 = 1200 device pixels.",
    points: ["the 50vw branch applies above 600px", "multiply by the device pixel ratio"],
    good: "50vw is 600 CSS pixels, times 2 for retina, so 1200.",
    bad: "600, half the screen.",
    errorType: "PROCEDURE",
    rule: "Slot width in device pixels = sizes width in CSS pixels times the device pixel ratio.",
    explain: "The browser resolves sizes to CSS pixels first (50vw = 600px here), then multiplies by the device pixel ratio to decide which file is big enough.",
  },
  {
    key: "r4",
    obj: "R",
    difficulty: 3,
    text: "When should you use picture with source media attributes instead of srcset alone?",
    model: "For art direction: when small screens need a different crop or a different image, not just a different resolution.",
    points: ["art direction", "srcset only switches resolutions of the same image"],
    good: "When you want a different crop or image on small screens. srcset only swaps resolutions of the same picture.",
    bad: "Whenever you have more than one file size.",
    partial: "When the image needs to change on mobile, I think.",
    errorType: "MISCONCEPTION",
    rule: "picture is for art direction (different crops); srcset is for resolution switching.",
    explain: "srcset assumes every candidate is the same image at different resolutions. picture with media conditions lets you serve a different composition at each breakpoint.",
  },
  {
    key: "r5",
    obj: "R",
    difficulty: 2,
    text: "Write a srcset for a 64px avatar that stays sharp on 2x screens.",
    model: "srcset=\"avatar-64.png 1x, avatar-128.png 2x\"",
    points: ["density descriptors for fixed-size images", "don't mix x and w"],
    good: "srcset=\"avatar-64.png 1x, avatar-128.png 2x\"",
    bad: "srcset=\"avatar-64.png 64w, avatar-128.png 2x\"",
    errorType: "PROCEDURE",
    rule: "Use density descriptors for fixed-size images, and never mix x and w in one srcset.",
    explain: "A fixed-size image only needs one file per pixel density. Mixing x and w descriptors in the same srcset is invalid.",
  },
  // Media queries
  {
    key: "m1",
    obj: "M",
    difficulty: 2,
    text: "In a mobile-first stylesheet, which kind of media query do you add as screens get wider?",
    model: "min-width queries. The base styles target small screens, and min-width queries add rules as space grows.",
    points: ["base styles are for small screens", "add min-width queries"],
    good: "min-width queries, because the base styles are already for phones.",
    bad: "max-width queries for each phone size.",
    errorType: "MISCONCEPTION",
    rule: "Mobile first means base styles for small screens plus min-width queries.",
    explain: "Mobile-first CSS starts from the smallest layout and layers on changes with min-width queries as the viewport grows.",
  },
  {
    key: "m2",
    obj: "M",
    difficulty: 2,
    text: "What happens on a phone if the viewport meta tag is missing?",
    model: "The browser renders the page at a desktop width (about 980px) and scales it down, so small-screen media queries never apply.",
    points: ["renders at desktop width", "scales down", "media queries for small screens don't match"],
    good: "The phone pretends it's about 980px wide and zooms out, so the mobile media queries never kick in.",
    bad: "Nothing changes, it's just for SEO.",
    errorType: "MEMORY",
    rule: "Without the viewport meta tag, mobile browsers lay out at desktop width and media queries for small screens don't match.",
    explain: "Mobile browsers default to a virtual viewport around 980px wide. width=device-width tells them to use the real screen width.",
  },
  {
    key: "m3",
    obj: "M",
    difficulty: 2,
    text: "How should you choose breakpoints?",
    model: "Where the content starts to break or look cramped, not at specific device widths.",
    points: ["content-driven", "not device-driven"],
    good: "Resize until the layout looks bad and put a breakpoint there, not at specific phone widths.",
    bad: "Use the exact widths of popular phones like 375 and 414.",
    errorType: "MISCONCEPTION",
    rule: "Pick breakpoints where the content breaks, not at device widths.",
    explain: "Device widths change every year. Breakpoints tied to the content keep working on screens you didn't test.",
  },
  {
    key: "m4",
    obj: "M",
    difficulty: 2,
    text: "Which query applies a three-column gallery only at 768px and wider?",
    mcq: {
      choices: [
        "@media (min-width: 768px)",
        "@media (max-width: 768px)",
        "@media (width: 768px)",
        "@media (min-device-width: 768px)",
      ],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. min-width matches 768px and anything wider.",
        "max-width matches 768px and narrower, the opposite.",
        "This matches exactly 768px only.",
        "Device-width queries are deprecated and ignore the window size.",
      ],
    },
    model: "@media (min-width: 768px).",
    points: ["min-width means this width and up"],
    good: "@media (min-width: 768px).",
    bad: "@media (max-width: 768px).",
    errorType: "CARELESS",
    rule: "min-width means this width and wider; max-width means this width and narrower.",
    explain: "min-width: 768px is true for viewports 768px wide or more, which is what a wide-screen gallery needs.",
  },
];

// ---------------------------------------------------------------------------
// AEM 2210: Financial Accounting
// ---------------------------------------------------------------------------

const AEM2210_DOCS: DemoDoc[] = [
  {
    file: "aem2210-week-3-accrual-vs-cash.md",
    title: "Week 3: Accrual versus cash basis accounting",
    uploaded: [-21, "17:20"],
    summary:
      "The difference between cash and accrual timing, when revenue is recognized, unearned revenue as a liability, and the matching principle for expenses.",
    questions: [
      "When is revenue recognized under the accrual basis?",
      "Why is cash received in advance a liability?",
      "How does the matching principle treat December wages paid in January?",
    ],
    body: `# Week 3: Accrual versus cash basis accounting

## Two ways to time revenue and expenses

Under the cash basis, a business records revenue when cash is received and expenses when cash is paid. Under the accrual basis, revenue is recorded when it is earned and expenses when they are incurred, regardless of when cash changes hands. US GAAP requires the accrual basis for financial statements because it matches the effort of a period with the results of that period.

## Revenue recognition

Revenue is recognized when the company satisfies a performance obligation by transferring a good or service to the customer. A landscaping company that mows a lawn on March 28 and is paid on April 5 records March revenue under accrual accounting and April revenue under cash accounting. Cash received in advance is not revenue yet: it is a liability called unearned (deferred) revenue until the work is done.

## The matching principle

Expenses are recorded in the same period as the revenue they helped produce. Wages earned by employees in the last week of December are a December expense even if payday is January 3. Supplies bought in bulk are an asset until they are used; only the portion consumed becomes supplies expense.

## Example

On December 1, Ithaca Bikes receives $1,200 for a 12-month service plan. Cash basis: $1,200 of revenue in December. Accrual basis: $100 of revenue in December and an $1,100 unearned revenue liability at year end. Accrual net income is smaller this year and larger next year, but total revenue over the 12 months is the same under both methods.

## Why it matters

The cash basis is simpler and is allowed for some small businesses for tax purposes. The accrual basis gives investors a better picture of performance, because a large prepayment or a delayed bill does not distort a single period.
`,
  },
  {
    file: "aem2210-week-4-journal-entries.md",
    title: "Week 4: Journal entries, T-accounts, and adjusting entries",
    uploaded: [-21, "17:22"],
    summary:
      "Debit and credit rules for each account type, recording journal entries, posting to T-accounts, the four common adjusting entries, and depreciation.",
    questions: [
      "Which account types increase with a debit?",
      "What are the four common adjusting entries?",
      "Why does an adjusting entry never involve Cash?",
    ],
    body: `# Week 4: Journal entries, T-accounts, and adjusting entries

## Debits and credits

Every transaction affects at least two accounts, and total debits equal total credits. Debits increase assets, expenses and dividends; credits increase liabilities, equity and revenue. A quick way to remember it: assets are on the left of the accounting equation (Assets = Liabilities + Equity), so they grow on the left, or debit, side of a T-account.

## Recording a journal entry

List the debited account first, then the credited account, indented. Paying $500 of rent in cash:

Dr. Rent Expense 500
    Cr. Cash 500

Buying $2,000 of equipment on account:

Dr. Equipment 2,000
    Cr. Accounts Payable 2,000

## T-accounts

A T-account shows one account's debits on the left and credits on the right. The balance is the difference, on the side with the larger total. Posting each journal entry to its T-accounts makes errors easier to spot before preparing a trial balance.

## Adjusting entries

At the end of a period, adjusting entries bring accounts up to date under the accrual basis. There are four common types:

1. Accrued revenue: earned but not yet billed or collected (Dr. Accounts Receivable, Cr. Service Revenue).
2. Accrued expense: incurred but not yet paid, such as wages (Dr. Wages Expense, Cr. Wages Payable).
3. Deferred revenue earned: part of a prepayment is now earned (Dr. Unearned Revenue, Cr. Service Revenue).
4. Prepaid expense used up: part of an asset is consumed, such as insurance or supplies (Dr. Insurance Expense, Cr. Prepaid Insurance).

Adjusting entries never involve Cash. If an entry you are calling an adjustment touches Cash, it is a regular transaction.

## Depreciation

Equipment is spread over its useful life with Dr. Depreciation Expense, Cr. Accumulated Depreciation. Accumulated Depreciation is a contra-asset account, so its normal balance is a credit.
`,
  },
];

const AEM2210_OBJECTIVES: DemoObjective[] = [
  {
    code: "A",
    title: "Accrual versus cash basis",
    recall: "Cash basis records revenue and expenses when cash moves. Accrual records them when they're earned or incurred.",
    weak: "Accrual is when you record things before you get paid? Cash is when you get paid.",
  },
  {
    code: "RR",
    title: "Revenue recognition",
    recall: "Revenue is recognized when the performance obligation is satisfied. Cash received early is unearned revenue, a liability.",
    weak: "You recognize revenue when you get the money, unless it's a big contract.",
  },
  {
    code: "D",
    title: "Debits and credits",
    recall: "Debits increase assets, expenses and dividends. Credits increase liabilities, equity and revenue. Debits always equal credits.",
    weak: "Debit is left and credit is right. Debits are good for assets I think.",
  },
  {
    code: "J",
    title: "Adjusting entries",
    recall: "Adjusting entries update accrued revenue, accrued expenses, deferred revenue and prepaid expenses at period end, and never touch Cash.",
    weak: "You adjust accounts at the end of the month so they're right. Not sure which accounts.",
  },
];

const AEM2210_QUESTIONS: DemoQuestion[] = [
  {
    key: "a1",
    obj: "A",
    difficulty: 1,
    text: "A landscaper mows a lawn on March 28 and is paid April 5. In which month is the revenue recorded under each basis?",
    model: "Accrual: March, when the work is done. Cash: April, when the payment arrives.",
    points: ["accrual records when earned", "cash records when received"],
    good: "Accrual puts it in March because that's when it was earned; cash basis puts it in April.",
    bad: "April under both, since that's when they got paid.",
    errorType: "MISCONCEPTION",
    rule: "Accrual records revenue when it's earned, not when cash arrives.",
    explain: "The service was performed in March, so accrual accounting records March revenue. Only the cash basis waits for the April payment.",
  },
  {
    key: "a2",
    obj: "A",
    difficulty: 2,
    text: "Why does US GAAP require the accrual basis for financial statements?",
    model: "It matches revenue with the expenses that produced it in the same period, so one period's results aren't distorted by when cash moved.",
    points: ["matching", "performance not distorted by cash timing"],
    good: "Because it matches revenue and expenses to the period they belong to, so a big prepayment doesn't distort one month.",
    bad: "Because it's easier to audit cash.",
    errorType: "MEMORY",
    rule: "Accrual is required because it matches revenue and expenses to the period of the activity.",
    explain: "Accrual accounting ties results to the period the work happened, which makes performance comparable across periods.",
  },
  {
    key: "a3",
    obj: "A",
    difficulty: 3,
    text: "On December 1 a shop receives $1,200 for a 12-month service plan. How much December revenue does it report under each basis?",
    model: "Cash basis: $1,200. Accrual basis: $100, with $1,100 of unearned revenue at year end.",
    points: ["cash: all $1,200", "accrual: one month, $100", "$1,100 unearned revenue"],
    good: "Cash: $1,200. Accrual: $100 for one month, and the other $1,100 is unearned revenue.",
    bad: "$1,200 under both because the cash came in December.",
    errorType: "PROCEDURE",
    rule: "Under accrual, recognize only the portion earned in the period; the rest stays in unearned revenue.",
    explain: "One of twelve months of service was delivered in December, so accrual revenue is $1,200 / 12 = $100. The remaining $1,100 is still owed to the customer as service.",
  },
  {
    key: "rr1",
    obj: "RR",
    difficulty: 2,
    text: "A customer pays $600 in September for tutoring sessions held in October. How is the September receipt classified?",
    mcq: {
      choices: [
        "As unearned revenue, a liability",
        "As September service revenue",
        "As October service revenue, recorded in September",
        "As accounts receivable",
      ],
      correct: 0,
      trap: 1,
      rationales: [
        "Correct. The service hasn't been delivered, so the company owes it: a liability.",
        "Revenue needs the obligation to be satisfied, and nothing was delivered in September.",
        "Revenue can't be recorded before it's earned, even with a future label.",
        "Receivables are amounts customers owe; here the customer already paid.",
      ],
    },
    model: "Unearned revenue, a liability, until the October sessions happen.",
    points: ["cash in advance is a liability", "revenue when the service is delivered"],
    good: "It's unearned revenue, a liability, until the sessions actually happen in October.",
    bad: "It's revenue in September because the cash came in.",
    errorType: "MISCONCEPTION",
    rule: "Cash received before the work is done is unearned revenue, a liability, not revenue.",
    explain: "Revenue is recognized when the performance obligation is satisfied. Until the October sessions happen, the company owes the customer service, so the cash sits in unearned revenue.",
  },
  {
    key: "rr2",
    obj: "RR",
    difficulty: 2,
    text: "When is revenue recognized under the accrual basis?",
    model: "When the company satisfies a performance obligation by transferring the good or service to the customer.",
    points: ["performance obligation satisfied", "good or service transferred"],
    good: "When the company actually delivers the good or service, which satisfies the performance obligation.",
    bad: "When the invoice is sent.",
    errorType: "MEMORY",
    rule: "Revenue is recognized when the performance obligation is satisfied.",
    explain: "Billing and collecting are separate events. Recognition is tied to delivering what was promised.",
  },
  {
    key: "rr3",
    obj: "RR",
    difficulty: 3,
    text: "Employees earn $3,000 of wages in the last week of December, paid January 3. When is the expense recorded under accrual, and why?",
    model: "December, under the matching principle: the wages helped produce December revenue.",
    points: ["December expense", "matching principle", "wages payable at year end"],
    good: "December, because of matching. It's an accrued expense with wages payable until January.",
    bad: "January 3, when the cash goes out.",
    errorType: "MISCONCEPTION",
    rule: "Expenses go in the period they help produce revenue, not when they're paid.",
    explain: "The matching principle puts the wages in December, with a Wages Payable liability until payday.",
  },
  {
    key: "d1",
    obj: "D",
    difficulty: 1,
    text: "Which account types increase with a debit?",
    model: "Assets, expenses and dividends.",
    points: ["assets", "expenses", "dividends"],
    good: "Assets, expenses and dividends.",
    bad: "Assets and revenue.",
    errorType: "MEMORY",
    rule: "Debits increase assets, expenses and dividends; credits increase liabilities, equity and revenue.",
    explain: "Accounts on the left of the equation, plus the accounts that reduce equity (expenses and dividends), grow with debits.",
  },
  {
    key: "d2",
    obj: "D",
    difficulty: 2,
    text: "Write the journal entry for buying $2,000 of equipment on account.",
    model: "Dr. Equipment 2,000; Cr. Accounts Payable 2,000.",
    points: ["debit Equipment", "credit Accounts Payable"],
    good: "Dr. Equipment 2,000, Cr. Accounts Payable 2,000.",
    bad: "Dr. Equipment 2,000, Cr. Cash 2,000.",
    errorType: "CARELESS",
    rule: "On account means a payable, not cash.",
    explain: "Buying on account creates a liability. Cash is untouched until the bill is paid.",
  },
  {
    key: "d3",
    obj: "D",
    difficulty: 2,
    text: "What is the normal balance of Accumulated Depreciation, and why?",
    model: "Credit. It's a contra-asset account that offsets the equipment's debit balance.",
    points: ["credit balance", "contra-asset"],
    good: "Credit, because it's a contra-asset that reduces equipment.",
    bad: "Debit, because it's an asset account.",
    errorType: "MISCONCEPTION",
    rule: "Contra accounts carry the opposite normal balance of the account they offset.",
    explain: "Accumulated Depreciation sits with assets but reduces them, so its normal balance is a credit.",
  },
  {
    key: "j1",
    obj: "J",
    difficulty: 3,
    text: "Half of a $1,200 prepaid insurance policy has expired at month end. Write the adjusting entry.",
    model: "Dr. Insurance Expense 600; Cr. Prepaid Insurance 600.",
    points: ["expense the used portion", "reduce the prepaid asset"],
    good: "Dr. Insurance Expense 600, Cr. Prepaid Insurance 600.",
    bad: "Dr. Prepaid Insurance 600, Cr. Cash 600.",
    errorType: "PROCEDURE",
    rule: "A used-up prepaid moves from the asset to expense: Dr. Expense, Cr. Prepaid. No cash.",
    explain: "The policy was paid earlier. At month end, the expired half becomes expense and the asset shrinks by the same amount.",
  },
  {
    key: "j2",
    obj: "J",
    difficulty: 3,
    text: "Why does an adjusting entry never involve Cash?",
    model: "Adjustments record what was earned or incurred without a cash event; any entry that moves cash is a regular transaction.",
    points: ["adjustments are non-cash", "cash entries are transactions"],
    good: "Because adjustments catch up on things earned or used that didn't have a cash event. If cash moves it's a normal transaction.",
    bad: "They can, like paying wages at the end of the month.",
    partial: "Because cash is already up to date? Not sure.",
    errorType: "MISCONCEPTION",
    rule: "Adjusting entries never touch Cash; if cash moves, it's a regular transaction.",
    explain: "Cash is recorded when it moves, so it's always current. Adjustments fix the accrual-based accounts that changed without cash moving.",
  },
  {
    key: "j3",
    obj: "J",
    difficulty: 2,
    text: "A company earned $800 of service revenue in June but won't bill the client until July. What is the June adjusting entry?",
    model: "Dr. Accounts Receivable 800; Cr. Service Revenue 800.",
    points: ["accrued revenue", "debit receivable", "credit revenue"],
    good: "Dr. Accounts Receivable 800, Cr. Service Revenue 800.",
    bad: "No entry until the bill goes out.",
    errorType: "PROCEDURE",
    rule: "Accrued revenue: Dr. Accounts Receivable, Cr. Revenue in the period it's earned.",
    explain: "The work is done in June, so June gets the revenue even though the invoice comes later.",
  },
];

// ---------------------------------------------------------------------------
// INFO 4340: Web Prototyping
// ---------------------------------------------------------------------------

const INFO4340_DOCS: DemoDoc[] = [
  {
    file: "info4340-lecture-5-components-props-events.md",
    title: "Lecture 5: Vue components, props, and events",
    uploaded: [-17, "20:05"],
    summary:
      "Single-file components with script setup and scoped styles, one-way data flow with props, emitting events to parents, v-model on components, and keys in v-for lists.",
    questions: [
      "Why are props read-only in the child?",
      "What does v-model expand to on a custom component?",
      "Why is the array index a bad key for v-for?",
    ],
    body: `# Lecture 5: Vue components, props, and events

## Single-file components

A Vue single-file component (.vue) keeps a component's template, script and styles together. With script setup, every top-level binding in the script is available in the template, so there is no need to return values from a setup() function.

<script setup>
import { ref } from "vue";
const count = ref(0);
</script>

<template>
  <button @click="count++">Clicked {{ count }} times</button>
</template>

The scoped attribute on a style block limits its rules to this component by adding a unique data attribute to its elements.

## Props flow down

A parent passes data to a child through props. In the child, declare them with defineProps:

const props = defineProps({ title: String, done: Boolean });

Props are read-only in the child. If a child needs to change a value it received, it should emit an event and let the parent update its own state. This one-way data flow keeps it clear which component owns each piece of state.

## Events flow up

Declare events with defineEmits and fire them with emit:

const emit = defineEmits(["toggle"]);
function onClick() { emit("toggle", props.id); }

The parent listens with @toggle="handleToggle". For two-way binding on a custom component, v-model is shorthand for a modelValue prop plus an update:modelValue event.

## Lists and keys

v-for renders a list, and each item needs a unique, stable :key so Vue can track which element is which when the list changes. Using the array index as the key causes bugs when items are inserted or reordered, because state sticks to the position instead of the item.
`,
  },
  {
    file: "info4340-lecture-6-reactive-state.md",
    title: "Lecture 6: Reactive state with ref, reactive, and computed",
    uploaded: [-17, "20:06"],
    summary:
      "ref and reactive for state, why destructuring breaks reactivity, cached computed properties, watch for side effects, and onMounted for DOM work.",
    questions: [
      "When do you need .value on a ref?",
      "Why does destructuring a reactive object break reactivity?",
      "When should you use computed instead of watch?",
    ],
    body: `# Lecture 6: Reactive state with ref, reactive, and computed

## ref

ref() wraps a value in a reactive object. In the script you read and write it through .value; in the template Vue unwraps it automatically, so you write {{ count }}, not {{ count.value }}. ref works for any type, including primitives like numbers and strings.

## reactive

reactive() makes an object deeply reactive without .value. It only works with objects, and destructuring a reactive object breaks reactivity: const { total } = cart copies the current value into a plain variable. Use toRefs(cart) if you need to destructure.

## computed

A computed property derives a value from other reactive state and caches it until one of its dependencies changes:

const remaining = computed(() => todos.value.filter(t => !t.done).length);

Computed getters should be pure: no API calls and no changes to other state. If a value can be calculated from existing state, make it computed instead of storing a copy that can drift out of sync.

## watch

watch runs a side effect when a source changes, such as saving to localStorage or fetching data when a search term changes:

watch(query, async (q) => { results.value = await search(q); });

Use computed for values and watch for effects. A common mistake is using watch to keep a second piece of state in sync with the first, which a computed property does with less code and no risk of stale values.

## Lifecycle

onMounted runs after the component is inserted into the DOM, which makes it the right place for code that needs real elements, like measuring a chart container. Data fetching can start in setup itself.
`,
  },
];

const INFO4340_OBJECTIVES: DemoObjective[] = [
  {
    code: "C",
    title: "Single-file components",
    recall: "A .vue file has template, script and style together. With script setup, top-level bindings are usable in the template directly.",
    weak: "A .vue file has the HTML and JS in one place. Not sure what setup changes.",
  },
  {
    code: "P",
    title: "Props and emits",
    recall: "Props go down from parent to child and are read-only. The child emits events up and the parent changes its own state.",
    weak: "Props pass data to children. I think the child can change them if needed?",
  },
  {
    code: "RF",
    title: "ref and reactive",
    recall: "ref wraps any value and needs .value in script; reactive makes objects reactive without .value but breaks if you destructure.",
    weak: "ref and reactive both make state reactive. Not sure when to pick which.",
  },
  {
    code: "CW",
    title: "computed and watch",
    recall: "computed derives cached values from state; watch runs side effects when something changes.",
    weak: "Both react to changes. watch is maybe more powerful?",
  },
];

const INFO4340_QUESTIONS: DemoQuestion[] = [
  {
    key: "c1",
    obj: "C",
    difficulty: 1,
    text: "With script setup, how does the template get access to a variable declared in the script?",
    model: "Every top-level binding in script setup is available in the template automatically; nothing needs to be returned.",
    points: ["top-level bindings are exposed", "no return statement"],
    good: "Anything declared at the top level of script setup is automatically usable in the template.",
    bad: "You have to return it from setup().",
    errorType: "MEMORY",
    rule: "In script setup, top-level bindings are exposed to the template automatically.",
    explain: "script setup compiles the component so that its top-level variables, imports and functions are in template scope.",
  },
  {
    key: "c2",
    obj: "C",
    difficulty: 2,
    text: "What does the scoped attribute on a style block do?",
    model: "It limits the styles to this component by adding a unique data attribute to its elements and to the selectors.",
    points: ["styles apply only to this component", "unique data attribute"],
    good: "It keeps the CSS inside the component by adding a unique data attribute to its elements.",
    bad: "It makes the styles load only when the component is visible.",
    errorType: "MISCONCEPTION",
    rule: "scoped rewrites selectors with a unique data attribute so styles only match this component.",
    explain: "Vue adds a data-v attribute to the component's elements and to each selector, so the rules can't leak to other components.",
  },
  {
    key: "c3",
    obj: "C",
    difficulty: 2,
    text: "Why is the array index a bad :key for a v-for list that can be reordered?",
    model: "State sticks to the position instead of the item, so inserting or reordering items attaches state to the wrong element.",
    points: ["keys must be stable and unique", "index changes on reorder"],
    good: "Because the index changes when items move, so Vue reuses the wrong element and state ends up on the wrong item.",
    bad: "Index keys are fine, they're unique.",
    errorType: "MISCONCEPTION",
    rule: "Use a stable unique id as the key; the index changes when items move.",
    explain: "Vue matches elements to data by key. If keys follow positions, a reorder makes Vue patch elements in place and their state stays behind.",
  },
  {
    key: "p1",
    obj: "P",
    difficulty: 2,
    text: "A child component receives a done prop and needs to toggle it when clicked. What should it do?",
    model: "Emit an event, for example emit(\"toggle\", id), and let the parent update its own state; props are read-only in the child.",
    points: ["props are read-only", "emit an event", "the parent owns the state"],
    good: "Emit a toggle event with the id and let the parent change done, since props are read-only.",
    bad: "Set props.done = !props.done inside the child.",
    errorType: "MISCONCEPTION",
    rule: "Props are read-only. The child emits an event and the parent updates its own state.",
    explain: "One-way data flow keeps one owner for each piece of state. Mutating a prop from the child would be overwritten on the parent's next render.",
  },
  {
    key: "p2",
    obj: "P",
    difficulty: 2,
    text: "What does v-model expand to on a custom component?",
    model: "A modelValue prop plus an update:modelValue event.",
    points: ["modelValue prop", "update:modelValue event"],
    good: "A modelValue prop and an update:modelValue event.",
    bad: "A value prop and an input event.",
    errorType: "MEMORY",
    rule: "On components, v-model = modelValue prop + update:modelValue event.",
    explain: "Vue 3 changed the defaults from Vue 2's value and input to modelValue and update:modelValue.",
  },
  {
    key: "p3",
    obj: "P",
    difficulty: 1,
    text: "How does a child declare the events it can emit with script setup?",
    model: "With defineEmits, for example const emit = defineEmits([\"toggle\"]).",
    points: ["defineEmits"],
    good: "const emit = defineEmits([\"toggle\"]).",
    bad: "With this.$emit, no declaration needed.",
    errorType: "MEMORY",
    rule: "Declare events with defineEmits in script setup.",
    explain: "defineEmits declares the component's events and returns the emit function used to fire them.",
  },
];

export const COURSES: Record<string, DemoCourse> = {
  INFO1300: {
    name: "INFO 1300",
    exam: "Prelim 2",
    examOffset: 7,
    objectives: INFO1300_OBJECTIVES,
    docs: INFO1300_DOCS,
    questions: INFO1300_QUESTIONS,
  },
  AEM2210: {
    name: "AEM 2210",
    exam: "Prelim 1",
    examOffset: 17,
    objectives: AEM2210_OBJECTIVES,
    docs: AEM2210_DOCS,
    questions: AEM2210_QUESTIONS,
  },
  INFO4340: {
    name: "INFO 4340",
    exam: "Midterm",
    examOffset: 22,
    objectives: INFO4340_OBJECTIVES,
    docs: INFO4340_DOCS,
    questions: INFO4340_QUESTIONS,
  },
  ECON1110: {
    name: "ECON 1110",
    exam: "Final",
    examOffset: 60,
    objectives: [
      {
        code: "SM",
        title: "Shifts and movements along a curve",
        recall: "A price change moves along the curve; anything else that affects buyers or sellers shifts it.",
        weak: "Demand goes up when price goes down, so the curve shifts.",
      },
      {
        code: "EQ",
        title: "Market equilibrium",
        recall: "Equilibrium is where quantity supplied equals quantity demanded; a surplus pushes price down and a shortage pushes it up.",
        weak: "Where supply and demand cross.",
      },
      {
        code: "EL",
        title: "Price elasticity of demand",
        recall: "Percent change in quantity demanded over percent change in price, using the midpoint method.",
        weak: "How much demand changes when price changes.",
      },
    ],
    docs: [
      {
        file: "econ1110-lecture-4-supply-and-demand.md",
        title: "Lecture 4: Supply, demand, and equilibrium",
        uploaded: [-2, "12:40"],
        summary:
          "What moves along versus shifts the demand and supply curves, how surpluses and shortages push a market to equilibrium, and how to solve for it.",
        questions: [
          "What is the difference between a change in demand and a change in quantity demanded?",
          "What happens to price and quantity when demand shifts right?",
          "How do you solve for equilibrium from two linear equations?",
        ],
        body: `# Lecture 4: Supply, demand, and equilibrium

## Demand

The demand curve shows the quantity buyers want at each price, holding everything else constant. It slopes down: as the price of coffee rises, people buy less of it. A change in the good's own price moves along the curve. A change in anything else that affects buyers, such as income, the price of a substitute like tea, tastes or expectations, shifts the whole curve.

## Supply

The supply curve shows the quantity sellers offer at each price. It slopes up because higher prices cover higher marginal costs. A change in input costs, technology, the number of sellers or expectations shifts supply.

## Movement versus shift

"Demand increased" means the whole curve shifted right. "Quantity demanded increased" means a movement along the curve, caused by a lower price. Mixing these up is the most common mistake on prelim questions.

## Equilibrium

The market clears where quantity supplied equals quantity demanded. Above the equilibrium price there is a surplus, which pushes the price down; below it there is a shortage, which pushes the price up.

Example: Qd = 100 - 2P and Qs = 20 + 2P. Setting them equal gives 100 - 2P = 20 + 2P, so P = 20 and Q = 60.

## Shifts and the new equilibrium

If demand shifts right while supply is unchanged, both the equilibrium price and quantity rise. If supply shifts right while demand is unchanged, price falls and quantity rises. When both curves shift at once, one of the two outcomes is ambiguous unless you know the size of each shift.
`,
      },
      {
        file: "econ1110-lecture-5-elasticity.md",
        title: "Lecture 5: Elasticity",
        uploaded: [-2, "12:41"],
        summary:
          "Price elasticity of demand with the midpoint method, what makes demand elastic, how elasticity predicts the effect of a price change on total revenue, and income and cross-price elasticity.",
        questions: [
          "How do you compute elasticity with the midpoint method?",
          "Why does raising the price of an inelastic good raise total revenue?",
          "What sign does cross-price elasticity have for complements?",
        ],
        body: `# Lecture 5: Elasticity

## Price elasticity of demand

Price elasticity of demand measures how much quantity demanded responds to a change in price:

Ed = (% change in quantity demanded) / (% change in price)

Economists usually report the absolute value. Demand is elastic when |Ed| > 1, inelastic when |Ed| < 1, and unit elastic when |Ed| = 1.

## The midpoint method

To get the same answer whether the price rises or falls, compute percentage changes using the average of the two values. If the price of a ticket rises from $8 to $12 and quantity falls from 110 to 90, the percentage change in quantity is -20/100 = -20% and the percentage change in price is 4/10 = 40%, so |Ed| = 0.5: inelastic.

## What makes demand elastic

Demand is more elastic when close substitutes exist, when the good is a luxury rather than a necessity, when the market is narrowly defined (a brand of cereal rather than food), and over longer time horizons.

## Elasticity and total revenue

Total revenue is price times quantity. When demand is inelastic, raising the price raises total revenue, because quantity falls by a smaller percentage. When demand is elastic, raising the price lowers total revenue. At unit elasticity, total revenue does not change.

## Other elasticities

Income elasticity is positive for normal goods and negative for inferior goods. Cross-price elasticity is positive for substitutes and negative for complements.
`,
      },
    ],
    questions: [],
  },
};

// ---------------------------------------------------------------------------
// Flashcard decks
// ---------------------------------------------------------------------------

export interface DemoCard {
  front: string;
  back: string;
  tags: string[];
  /** 0 = easy card, 1 = card this student keeps missing. */
  hardness: number;
}

export interface DemoDeck {
  course: string;
  title: string;
  docFile: string;
  created: When;
  cards: DemoCard[];
  /** Review days: when, how many new cards to introduce, and a cap on reviews. */
  sessions: { at: When; newCards: number; maxDue: number }[];
}

export const DECKS: DemoDeck[] = [
  {
    course: "AEM2210",
    title: "Debits, credits, and adjusting entries",
    docFile: "aem2210-week-4-journal-entries.md",
    created: [-21, "17:40"],
    cards: [
      { front: "Which account types increase with a debit?", back: "Assets, expenses, and dividends.", tags: ["Debits and credits"], hardness: 0.2 },
      { front: "Which account types increase with a credit?", back: "Liabilities, equity, and revenue.", tags: ["Debits and credits"], hardness: 0.2 },
      { front: "Journal entry: pay $500 of rent in cash", back: "Dr. Rent Expense 500\nCr. Cash 500", tags: ["Debits and credits"], hardness: 0.1 },
      { front: "Journal entry: buy $2,000 of equipment on account", back: "Dr. Equipment 2,000\nCr. Accounts Payable 2,000", tags: ["Debits and credits"], hardness: 0.3 },
      { front: "Accrued revenue adjusting entry", back: "Dr. Accounts Receivable\nCr. Service Revenue", tags: ["Adjusting entries"], hardness: 0.5 },
      { front: "Accrued expense (wages) adjusting entry", back: "Dr. Wages Expense\nCr. Wages Payable", tags: ["Adjusting entries"], hardness: 0.5 },
      { front: "Deferred revenue earned: adjusting entry", back: "Dr. Unearned Revenue\nCr. Service Revenue", tags: ["Adjusting entries"], hardness: 0.8 },
      { front: "Prepaid insurance used up: adjusting entry", back: "Dr. Insurance Expense\nCr. Prepaid Insurance", tags: ["Adjusting entries"], hardness: 0.6 },
      { front: "Do adjusting entries ever touch Cash?", back: "No. If an entry moves cash, it's a regular transaction, not an adjustment.", tags: ["Adjusting entries"], hardness: 0.4 },
      { front: "Normal balance of Accumulated Depreciation", back: "Credit. It's a contra-asset account.", tags: ["Debits and credits"], hardness: 0.7 },
    ],
    sessions: [
      { at: [-20, "17:10"], newCards: 6, maxDue: 0 },
      { at: [-19, "18:00"], newCards: 2, maxDue: 8 },
      { at: [-17, "17:30"], newCards: 2, maxDue: 8 },
      { at: [-2, "13:50"], newCards: 0, maxDue: 3 },
      { at: [-1, "17:40"], newCards: 0, maxDue: 3 },
    ],
  },
  {
    course: "INFO1300",
    title: "Layout and specificity",
    docFile: "info1300-lecture-16-flexbox-and-grid.md",
    created: [-11, "08:30"],
    cards: [
      { front: "Specificity of #nav a", back: "(1,0,1): one ID, one type.", tags: ["CSS specificity"], hardness: 0.6 },
      { front: "Do eleven classes beat one ID?", back: "No. Specificity columns never carry: (0,11,0) loses to (1,0,0).", tags: ["CSS specificity"], hardness: 0.9 },
      { front: "When does source order decide between two rules?", back: "Only when origin, importance, and specificity all tie.", tags: ["CSS specificity"], hardness: 0.8 },
      { front: "Specificity added by :where()", back: "Zero, whatever is inside it.", tags: ["CSS specificity"], hardness: 0.7 },
      { front: "content-box width of width: 300px, padding: 20px, border: 2px", back: "344px on screen.", tags: ["Box model"], hardness: 0.3 },
      { front: "What does box-sizing: border-box change?", back: "Width includes padding and border; the content area shrinks.", tags: ["Box model"], hardness: 0.2 },
      { front: "Flexbox: center a child both ways", back: "Parent: display: flex; justify-content: center; align-items: center.", tags: ["Flexbox alignment"], hardness: 0.1 },
      { front: "flex: 1 expands to", back: "flex-grow: 1; flex-shrink: 1; flex-basis: 0%.", tags: ["Flexbox alignment"], hardness: 0.3 },
      { front: "grid-template-areas for header, sidebar + main, footer", back: "\"header header\"\n\"sidebar main\"\n\"footer footer\"", tags: ["Grid template areas"], hardness: 0.7 },
      { front: "What makes a grid-template-areas value invalid?", back: "A non-rectangular area, or rows with different numbers of cells.", tags: ["Grid template areas"], hardness: 0.8 },
      { front: "What does 800w mean in srcset?", back: "The file is 800 pixels wide (intrinsic width), not the display width.", tags: ["Responsive images and srcset"], hardness: 0.8 },
      { front: "What does the browser assume if sizes is missing?", back: "100vw, so it often downloads a larger file than needed.", tags: ["Responsive images and srcset"], hardness: 0.9 },
    ],
    sessions: [
      { at: [-11, "08:45"], newCards: 7, maxDue: 0 },
      { at: [-9, "12:30"], newCards: 3, maxDue: 8 },
      { at: [-4, "13:10"], newCards: 2, maxDue: 4 },
      { at: [-1, "12:40"], newCards: 0, maxDue: 3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Study guides (INFO 1300, Prelim 2)
// ---------------------------------------------------------------------------

export const GUIDES: {
  course: string;
  type: "KEY_CONCEPTS" | "FAQ" | "CHEAT_SHEET";
  title: string;
  created: When;
  sections: Record<string, string>[];
}[] = [
  {
    course: "INFO1300",
    type: "KEY_CONCEPTS",
    title: "Prelim 2 key concepts",
    created: [-2, "21:20"],
    sections: [
      {
        concept: "Specificity",
        explanation:
          "Selectors are scored as (IDs, classes, types) and compared column by column from the left. The first column that differs decides; columns never carry, so one ID beats any number of classes.",
        importance: "Most cascade questions come down to scoring two selectors correctly before thinking about source order.",
      },
      {
        concept: "The cascade order",
        explanation:
          "Origin and importance are checked first, then specificity, then source order. A later rule only wins when everything before it ties.",
        importance: "Explains why moving a rule lower in the file often changes nothing.",
      },
      {
        concept: "Box sizing",
        explanation:
          "content-box adds padding and border to the declared width; border-box includes them in it. Vertical margins between blocks collapse to the larger value.",
        importance: "Width arithmetic shows up in layout questions and in debugging overflow.",
      },
      {
        concept: "Flexbox axes",
        explanation:
          "justify-content aligns along the main axis and align-items along the cross axis. flex-direction: column swaps which direction each one controls.",
        importance: "Centering and spacing questions depend on knowing which axis is which.",
      },
      {
        concept: "Grid template areas",
        explanation:
          "Name regions on the container with one string per row; every row needs the same number of cells and every area must be a rectangle. Children claim regions with grid-area.",
        importance: "An invalid template silently drops the whole layout, which is easy to miss.",
      },
      {
        concept: "srcset and sizes",
        explanation:
          "w descriptors give each file's real width, and sizes gives the slot width the browser should plan for. The browser multiplies the slot by the pixel ratio and picks the smallest file that covers it.",
        importance: "Without sizes the browser assumes 100vw and over-downloads on wide layouts.",
      },
    ],
  },
  {
    course: "INFO1300",
    type: "FAQ",
    title: "Prelim 2 questions and answers",
    created: [-2, "21:22"],
    sections: [
      {
        question: "Why doesn't my later rule override an earlier one?",
        answer:
          "Source order only breaks ties. If the earlier rule has a higher specificity, for example because it uses an ID, it wins wherever it appears.",
      },
      {
        question: "Do I need sizes if I already have srcset?",
        answer:
          "Yes when srcset uses w descriptors. For a fixed-size image with x descriptors, sizes isn't needed.",
      },
      {
        question: "When should I use picture instead of srcset?",
        answer:
          "When small screens need a different crop or image (art direction). srcset only switches between resolutions of the same image.",
      },
      {
        question: "Flexbox or grid for a page layout?",
        answer:
          "Grid, because you are placing regions in rows and columns at once. Flexbox suits one-directional rows like a nav bar.",
      },
      {
        question: "Why is my grid layout ignored completely?",
        answer:
          "grid-template-areas is invalid if any area isn't a rectangle or if rows have different numbers of cells, and the browser drops the whole declaration.",
      },
    ],
  },
  {
    course: "INFO1300",
    type: "CHEAT_SHEET",
    title: "Prelim 2 cheat sheet",
    created: [-2, "21:25"],
    sections: [
      {
        topic: "Specificity",
        content:
          "ID = (1,0,0)\nclass, attribute, pseudo-class = (0,1,0)\ntype, pseudo-element = (0,0,1)\n:where() = 0; :is() and :not() = most specific argument\ninline style beats selectors; !important beats inline",
      },
      {
        topic: "Box model",
        content:
          "content-box: rendered width = width + padding + border\nborder-box: rendered width = width\nAdjacent vertical margins collapse to the larger one",
      },
      {
        topic: "Flexbox and grid",
        content:
          "justify-content: main axis; align-items: cross axis\nflex: 1 = 1 1 0%\ngrid-template-areas: one string per row, same cell count, rectangles only\n. = empty cell; children use grid-area: name",
      },
      {
        topic: "Responsive images",
        content:
          "srcset w = file width; sizes = slot width (default 100vw)\nx descriptors for fixed-size images; don't mix x and w\npicture + source media for art direction\nMobile first: min-width queries; viewport meta tag required",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Chat history
// ---------------------------------------------------------------------------

export interface DemoChatMessage {
  role: "user" | "assistant";
  at: When;
  content: string;
  /** Citations point at a phrase inside one of the course's documents. */
  cites?: { docFile: string; phrase: string; reason: string }[];
}

export const CHATS: { course: string; messages: DemoChatMessage[] }[] = [
  {
    course: "INFO1300",
    messages: [
      {
        role: "user",
        at: [-3, "21:12"],
        content: "Why does an ID beat a bunch of classes even when the class selector is longer?",
      },
      {
        role: "assistant",
        at: [-3, "21:12"],
        content:
          "Specificity is compared column by column, left to right: IDs, then classes, then types. The first column that differs decides, and the columns never carry over. So #nav a scores (1,0,1) and beats .menu .item .link at (0,3,0), even though the second selector is longer [1].\n\nSource order only matters when every column ties [1].",
        cites: [
          {
            docFile: "info1300-lecture-14-specificity-and-box-model.md",
            phrase: "Compare the columns left to right",
            reason: "Defines the column-by-column comparison and the no-carry rule",
          },
        ],
      },
      {
        role: "user",
        at: [-2, "20:41"],
        content: "Do I need sizes if I already have srcset?",
      },
      {
        role: "assistant",
        at: [-2, "20:41"],
        content:
          "If the srcset uses w descriptors, yes. The browser picks a file before CSS loads, so sizes tells it how wide the image slot will be. Without sizes it assumes 100vw and often downloads a much larger file than needed [1].\n\nFor an image shown at a fixed size, like a 64px avatar, use x descriptors instead and leave sizes out [2].",
        cites: [
          {
            docFile: "info1300-lecture-18-responsive-images.md",
            phrase: "If you use w descriptors and leave out sizes",
            reason: "Explains what happens without sizes",
          },
          {
            docFile: "info1300-lecture-18-responsive-images.md",
            phrase: "density descriptors are simpler",
            reason: "Covers density descriptors for fixed-size images",
          },
        ],
      },
    ],
  },
  {
    course: "AEM2210",
    messages: [
      {
        role: "user",
        at: [-1, "19:05"],
        content: "Is unearned revenue a liability or revenue?",
      },
      {
        role: "assistant",
        at: [-1, "19:05"],
        content:
          "A liability. Cash received before the work is done is owed back to the customer as service, so it sits in Unearned Revenue until it's earned [1]. When part of it is earned, an adjusting entry moves that part: Dr. Unearned Revenue, Cr. Service Revenue [2].",
        cites: [
          {
            docFile: "aem2210-week-3-accrual-vs-cash.md",
            phrase: "Cash received in advance is not revenue yet",
            reason: "States that prepayments are a liability",
          },
          {
            docFile: "aem2210-week-4-journal-entries.md",
            phrase: "Deferred revenue earned",
            reason: "Gives the adjusting entry when the revenue is earned",
          },
        ],
      },
    ],
  },
];
