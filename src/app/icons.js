import { ArrowUpDown, CircleHelp, CirclePlus, Keyboard, ListFilter, LogOut, MapPin, Plug, Settings, Smartphone, Star, createIcons } from "lucide";

const AppIcons = Object.freeze({ ArrowUpDown, CircleHelp, CirclePlus, Keyboard, ListFilter, LogOut, MapPin, Plug, Settings, Smartphone, Star });

export function InitializeIcons() {
  createIcons({ icons: AppIcons });
}
