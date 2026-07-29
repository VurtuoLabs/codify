import { createElement } from "lwc";
import CodifyKpiCard from "c/codifyKpiCard";

function build(props = {}) {
  const element = createElement("c-codify-kpi-card", { is: CodifyKpiCard });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe("c-codify-kpi-card", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("shows a skeleton, and no value, while loading", () => {
    const element = build({
      label: "Drafts to review",
      value: 6,
      loading: true
    });
    expect(
      element.shadowRoot.querySelector("c-codify-skeleton-loader")
    ).not.toBeNull();
    expect(element.shadowRoot.querySelector(".codify-kpi__value")).toBeNull();
  });

  it("renders the label and value once loaded", () => {
    const element = build({ label: "Drafts to review", value: 6 });
    expect(
      element.shadowRoot.querySelector(".codify-kpi__label").textContent
    ).toBe("Drafts to review");
    expect(
      element.shadowRoot.querySelector(".codify-kpi__value").textContent
    ).toContain("6");
  });

  it("renders zero as a real figure rather than an empty state", () => {
    const element = build({ label: "Escalated", value: 0 });
    const value = element.shadowRoot.querySelector(".codify-kpi__value");
    expect(value.textContent).toContain("0");
    expect(value.className).not.toContain("unavailable");
  });

  it("shows a dash and the empty message when there is no value", () => {
    const element = build({
      label: "Published",
      value: null,
      emptyMessage: "Knowledge is not enabled."
    });
    expect(
      element.shadowRoot.querySelector(".codify-kpi__value").textContent
    ).toContain("-");
    expect(
      element.shadowRoot.querySelector(".codify-kpi__support").textContent
    ).toBe("Knowledge is not enabled.");
  });

  it("shows its own error state without hiding the label", () => {
    const element = build({
      label: "Published",
      value: 3,
      errorMessage: "Could not read Knowledge."
    });
    expect(
      element.shadowRoot.querySelector(".codify-kpi__error").textContent
    ).toBe("Could not read Knowledge.");
    expect(
      element.shadowRoot.querySelector(".codify-kpi__label").textContent
    ).toBe("Published");
  });

  it("clamps the progress bar to 0–100", async () => {
    const element = build({ label: "Reach", value: 40, progress: 240 });
    await Promise.resolve();
    expect(
      element.shadowRoot.querySelector("lightning-progress-bar").value
    ).toBe(100);
  });

  it("hides the progress bar when no proportion was given", () => {
    const element = build({ label: "Reach", value: 40 });
    expect(
      element.shadowRoot.querySelector("lightning-progress-bar")
    ).toBeNull();
  });

  it("only shows a trend when there is a trend label to explain it", () => {
    const element = build({
      label: "Described",
      value: 21,
      trendDirection: "up"
    });
    expect(element.shadowRoot.querySelector(".codify-kpi__trend")).toBeNull();
  });

  it("marks the hero variant so one figure can outrank the others", () => {
    const element = build({ label: "Drafts", value: 6, size: "hero" });
    expect(element.shadowRoot.querySelector(".codify-kpi").className).toContain(
      "codify-kpi_hero"
    );
  });
});
