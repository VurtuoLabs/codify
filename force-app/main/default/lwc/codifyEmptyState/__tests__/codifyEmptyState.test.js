import { createElement } from "lwc";
import CodifyEmptyState from "c/codifyEmptyState";

function build(props = {}) {
  const element = createElement("c-codify-empty-state", {
    is: CodifyEmptyState
  });
  Object.assign(element, props);
  document.body.appendChild(element);
  return element;
}

describe("c-codify-empty-state", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("explains the absence rather than leaving a blank box", () => {
    const element = build({
      title: "Nothing tagged yet",
      message: "Root causes appear once a recap corroborates one."
    });
    expect(
      element.shadowRoot.querySelector(".codify-empty__title").textContent
    ).toBe("Nothing tagged yet");
    expect(
      element.shadowRoot.querySelector(".codify-empty__message").textContent
    ).toBe("Root causes appear once a recap corroborates one.");
    expect(element.shadowRoot.querySelector("lightning-icon")).not.toBeNull();
  });

  it("offers no button when the reader cannot resolve it", () => {
    const element = build({ title: "Nothing yet" });
    expect(
      element.shadowRoot.querySelector(".codify-empty__actions")
    ).toBeNull();
  });

  it("fires an event for the recommended next action", () => {
    const element = build({
      title: "No changes match these filters",
      actionLabel: "Clear all filters"
    });
    const handler = jest.fn();
    element.addEventListener("action", handler);

    element.shadowRoot.querySelector("lightning-button").click();
    expect(handler).toHaveBeenCalled();
  });
});
