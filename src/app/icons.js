import { ArrowUpDown, CirclePlus, ListFilter, LogOut, Plug, Smartphone, createIcons } from "lucide";

const AppIcons = Object.freeze({ ArrowUpDown, CirclePlus, ListFilter, LogOut, Plug, Smartphone });

export function InitializeIcons() {
  createIcons({ icons: AppIcons });
}
