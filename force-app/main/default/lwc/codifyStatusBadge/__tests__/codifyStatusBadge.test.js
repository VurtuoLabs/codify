import { createElement } from "lwc";
import CodifyStatusBadge from "c/codifyStatusBadge";

function build(props = {}) {
  const element = createElement("c-codify-status-badge", {
    is: CodifyStatusBadge
  });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe("c-codify-status-badge", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("always renders the label, so state is never colour alone", () => {
    const element = build({ label: "Needs review", tone: "pending" });
    const label = element.shadowRoot.querySelector(".codify-badge__label");
    expect(label.textContent).toBe("Needs review");
  });

  it("pairs every tone with an icon", () => {
    const element = build({ label: "Documented", tone: "success" });
    const icon = element.shadowRoot.querySelector("lightning-icon");
    expect(icon.iconName).toBe("utility:success");
  });

  it("lets a caller override the icon", () => {
    const element = build({
      label: "Gap",
      tone: "critical",
      iconName: "utility:warning"
    });
    expect(element.shadowRoot.querySelector("lightning-icon").iconName).toBe(
      "utility:warning"
    );
  });

  it("falls back to the neutral tone when given nonsense", () => {
    const element = build({ label: "Unknown", tone: "chartreuse" });
    const badge = element.shadowRoot.querySelector(".codify-badge");
    expect(badge.className).toContain("codify-badge_neutral");
  });

  it("exposes a screen-reader prefix for context", () => {
    const element = build({ label: "Gap", assistivePrefix: "Coverage:" });
    const assistive = element.shadowRoot.querySelector(".slds-assistive-text");
    expect(assistive.textContent).toBe("Coverage:");
  });
});
