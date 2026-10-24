import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BottomSheet,
  Card,
  Chip,
  DialogPanel,
  DisplayNumeral,
  ExpressiveShape,
  FilledButton,
  IconButton,
  ListGroup,
  ListItem,
  NotificationCard,
  OutlinedButton,
  SegmentedControl,
  SegmentedProgress,
  TextButton,
  ThickSlider,
  TonalButton,
} from "@/design/components";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

describe("design primitives render", () => {
  it("Card uses its surface tier", () => {
    expect(html(<Card tier="high">x</Card>)).toContain("bg-surface-high");
    expect(html(<Card>x</Card>)).toContain('data-tier="container"');
  });

  it("buttons meet the 48px hit target and keep their labels", () => {
    for (const B of [FilledButton, TonalButton, OutlinedButton, TextButton]) {
      const out = html(<B>Go</B>);
      expect(out).toContain("min-h-12");
      expect(out).toContain(">Go</button>");
    }
    expect(html(<TonalButton fullWidth>Wide</TonalButton>)).toContain("w-full");
  });

  it("IconButton requires an accessible label and supports the destructive tone", () => {
    const out = html(<IconButton label="End" variant="destructive">x</IconButton>);
    expect(out).toContain('aria-label="End"');
    expect(out).toContain("bg-error");
    expect(out).toContain("size-12");
  });

  it("Chip maps every status to a tone and marks inconclusive with a dashed edge", () => {
    expect(html(<Chip status="broken">Broken</Chip>)).toContain("bg-error-container");
    expect(html(<Chip status="degraded">D</Chip>)).toContain("bg-tertiary-container");
    expect(html(<Chip status="resilient">R</Chip>)).toContain("bg-secondary-container");
    expect(html(<Chip status="inconclusive">I</Chip>)).toContain("border-dashed");
    expect(html(<Chip status="failed">F</Chip>)).toContain("<svg");
    expect(html(<Chip>N</Chip>)).not.toContain("<svg");
  });

  it("SegmentedControl renders one item per segment", () => {
    const out = html(<SegmentedControl label="Run" value="a" onChange={noop} segments={[{ value: "a", label: "Baseline" }, { value: "b", label: "Fault" }]} />);
    expect(out).toContain('aria-label="Run"');
    expect(out).toContain("Baseline");
    expect(out).toContain("Fault");
  });

  it("ThickSlider exposes slider semantics and a 40px track", () => {
    const out = html(<ThickSlider label="Reveal" value={30} onChange={noop} />);
    expect(out).toContain('role="slider"');
    expect(out).toContain('aria-valuenow="30"');
    expect(out).toContain("h-10");
  });

  it("SegmentedProgress renders gapped segments with phase text", () => {
    const out = html(<SegmentedProgress label="Scan" segments={[{ label: "Queued", state: "done" }, { label: "Running", state: "active" }, { label: "Completed", state: "pending" }]} />);
    expect(out.match(/<li/g)).toHaveLength(3);
    expect(out).toContain("Running: active");
    expect(out).toContain("gap-1.5");
  });

  it("ListGroup separates rows with gaps, not dividers", () => {
    const out = html(
      <ListGroup>
        <ListItem headline="One" supporting="first" />
        <ListItem headline="Two" />
      </ListGroup>,
    );
    expect(out).toContain("gap-0.5");
    expect(out).not.toMatch(/divide-|border-b/);
  });

  it("DialogPanel orders icon, title, keep-in-mind list and actions", () => {
    const out = html(<DialogPanel titleId="t" icon={<span>i</span>} title="Approve?" body="Body" keepInMind={["a", "b"]} actions={<FilledButton fullWidth>Approve</FilledButton>} />);
    expect(out.indexOf("Approve?")).toBeLessThan(out.indexOf("Keep in mind"));
    expect(out.indexOf("Keep in mind")).toBeLessThan(out.indexOf(">Approve</button>"));
    expect(out.match(/<li>/g)).toHaveLength(2);
  });

  it("BottomSheet renders only when open, with its landmark role and label", () => {
    expect(html(<BottomSheet open={false} onClose={noop} label="Details">x</BottomSheet>)).toBe("");
    const out = html(<BottomSheet open onClose={noop} label="Details" role="complementary">x</BottomSheet>);
    expect(out).toContain('role="complementary"');
    expect(out).toContain('aria-label="Details"');
  });

  it("DisplayNumeral, ExpressiveShape and NotificationCard render", () => {
    expect(html(<DisplayNumeral value="3" caption="of 9" />)).toContain("md-display-large");
    expect(html(<ExpressiveShape shape="scallop" />)).toContain('aria-hidden="true"');
    expect(html(<ExpressiveShape shape="blob" />)).toContain("<path");
    const card = html(<NotificationCard source="Devin" time="now" title="PR opened" body="b" href="/repairs/x" />);
    expect(card).toContain('href="/repairs/x"');
    expect(card).toContain("PR opened");
  });
});

// WCAG 2.x relative luminance contrast, computed from the generated palette.
function parseScheme(css: string, selector: string) {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--md-sys-color-([a-z-]+): (#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
}
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("generated palette contrast", () => {
  const css = readFileSync(new URL("../src/design/tokens.css", import.meta.url), "utf8");
  const schemes = { dark: parseScheme(css, ":root,\n[data-theme=\"dark\"]"), light: parseScheme(css, ':root[data-theme="light"]') };
  const pairs = [
    ["on-primary", "primary"],
    ["on-primary-container", "primary-container"],
    ["on-secondary", "secondary"],
    ["on-secondary-container", "secondary-container"],
    ["on-tertiary-container", "tertiary-container"],
    ["on-error-container", "error-container"],
    ["on-success-container", "success-container"],
    ["on-surface", "surface"],
    ["on-surface-variant", "surface-container-high"],
    ["on-surface", "surface-container-highest"],
  ] as const;
  for (const [theme, scheme] of Object.entries(schemes)) {
    for (const [fg, bg] of pairs) {
      it(`${theme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(scheme[fg], fg).toBeDefined();
        expect(contrast(scheme[fg], scheme[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
