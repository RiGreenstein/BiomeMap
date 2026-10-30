/** Minecraft-style chat messages that fade out in the bottom-left corner. */
let box: HTMLElement | null = null;

export function chat(text: string, color = "#ffffff"): void {
  box ??= document.getElementById("chat");
  if (!box) return;
  const line = document.createElement("div");
  line.className = "chat-line";
  line.style.color = color;
  line.textContent = text;
  box.appendChild(line);
  while (box.children.length > 6) box.firstElementChild?.remove();
  setTimeout(() => line.classList.add("fade"), 6000);
  setTimeout(() => line.remove(), 7500);
}
