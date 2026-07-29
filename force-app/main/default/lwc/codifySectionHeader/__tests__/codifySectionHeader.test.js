import { createElement } from "lwc";
import CodifySectionHeader from "c/codifySectionHeader";

function build(props = {}) {
  const element = createElement("c-codify-section-header", {
    is: CodifySectionHeader
  });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe("c-codify-section-header", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("renders the title as a real heading", () => {
    const element = build({ title: "The capture pipeline" });
    const heading = element.shadowRoot.querySelector("h2");
    expect(heading.textContent).toContain("The capture pipeline");
  });

  it("carries an eyebrow and a description of what the section is for", () => {
    const element = build({
      eyebrow: "Analysis",
      title: "What the record shows",
      description: "Ranked by volume."
    });
    expect(
      element.shadowRoot.querySelector(".codify-sh__eyebrow").textContent
    ).toBe("Analysis");
    expect(
      element.shadowRoot.querySelector(".codify-sh__description").textContent
    ).toBe("Ranked by volume.");
  });

  it("has no collapse control unless the section is collapsible", () => {
    const element = build({ title: "Fixed" });
    expect(element.shadowRoot.querySelector(".codify-sh__toggle")).toBeNull();
  });

  it("gives the icon-only toggle an accessible name and aria state", async () => {
    const element = build({
      title: "Latest audited actions",
      collapsible: true,
      expanded: true
    });
    const toggle = element.shadowRoot.querySelector(".codify-sh__toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("Collapse Latest audited actions");

    element.expanded = false;
    await Promise.resolve();
    expect(
      element.shadowRoot.querySelector(".codify-sh__toggle").textContent
    ).toContain("Expand Latest audited actions");
  });

  it("tells its parent when the toggle was activated", () => {
    const element = build({ title: "Analysis", collapsible: true });
    const handler = jest.fn();
    element.addEventListener("toggle", handler);
    element.shadowRoot.querySelector(".codify-sh__toggle").click();
    expect(handler).toHaveBeenCalled();
  });
});
