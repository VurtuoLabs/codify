import { createElement } from "lwc";
import CodifyErrorState from "c/codifyErrorState";

function build(props = {}) {
  const element = createElement("c-codify-error-state", {
    is: CodifyErrorState
  });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe("c-codify-error-state", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("announces itself and shows the friendly message", () => {
    const element = build({
      title: "The change log could not load",
      message: "Codify could not read the change log."
    });
    expect(element.shadowRoot.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      element.shadowRoot.querySelector(".codify-error__message").textContent
    ).toBe("Codify could not read the change log.");
  });

  it("falls back to an honest sentence when given no message", () => {
    const element = build({});
    expect(
      element.shadowRoot.querySelector(".codify-error__message").textContent
    ).toContain("Nothing has been changed");
  });

  it("keeps the raw error out of sight until asked for", async () => {
    const element = build({
      message: "Codify could not read this.",
      detail: "System.QueryException: unexpected token"
    });
    expect(
      element.shadowRoot.querySelector(".codify-error__detail")
    ).toBeNull();

    const toggle = Array.from(
      element.shadowRoot.querySelectorAll("lightning-button")
    ).find((b) => b.label === "Technical details");
    toggle.click();
    await Promise.resolve();

    expect(
      element.shadowRoot.querySelector(".codify-error__detail").textContent
    ).toContain("System.QueryException");
  });

  it("only offers retry when retrying could help", () => {
    const element = build({ message: "No." });
    expect(
      Array.from(element.shadowRoot.querySelectorAll("lightning-button")).some(
        (b) => b.label === "Try again"
      )
    ).toBe(false);
  });

  it("swaps the retry label while the retry is in flight", async () => {
    const element = build({ message: "No.", showRetry: true });
    const handler = jest.fn();
    element.addEventListener("retry", handler);

    const retry = element.shadowRoot.querySelector("lightning-button");
    expect(retry.label).toBe("Try again");
    retry.click();
    expect(handler).toHaveBeenCalled();

    element.retrying = true;
    await Promise.resolve();
    const busy = element.shadowRoot.querySelector("lightning-button");
    expect(busy.label).toBe("Retrying…");
    expect(busy.disabled).toBe(true);
  });
});
