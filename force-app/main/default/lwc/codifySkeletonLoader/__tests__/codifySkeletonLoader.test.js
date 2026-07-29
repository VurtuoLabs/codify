import { createElement } from "lwc";
import CodifySkeletonLoader from "c/codifySkeletonLoader";

function build(props = {}) {
  const element = createElement("c-codify-skeleton-loader", {
    is: CodifySkeletonLoader
  });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe("c-codify-skeleton-loader", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("announces that something is loading", () => {
    const element = build({ assistiveText: "Loading changes" });
    expect(element.shadowRoot.querySelector('[role="status"]')).not.toBeNull();
    expect(
      element.shadowRoot.querySelector(".slds-assistive-text").textContent
    ).toBe("Loading changes");
  });

  it("draws the requested number of lines", () => {
    const element = build({ count: 4 });
    expect(
      element.shadowRoot.querySelectorAll(".codify-skeleton__line").length
    ).toBe(4);
  });

  it("sizes table rows to the height the real rows will take", () => {
    const element = build({ variant: "rows", count: 3, height: "2.75rem" });
    const rows = element.shadowRoot.querySelectorAll(".codify-skeleton__row");
    expect(rows.length).toBe(3);
    expect(rows[0].style.height).toBe("2.75rem");
  });

  it("mirrors the KPI card's rhythm so nothing shifts on load", () => {
    const element = build({ variant: "kpi" });
    expect(
      element.shadowRoot.querySelector(".codify-skeleton__value")
    ).not.toBeNull();
    expect(
      element.shadowRoot.querySelector(".codify-skeleton__bar")
    ).not.toBeNull();
  });

  it("refuses a nonsense count rather than rendering thousands of rows", () => {
    const element = build({ count: 400 });
    expect(
      element.shadowRoot.querySelectorAll(".codify-skeleton__line").length
    ).toBe(40);
  });
});
