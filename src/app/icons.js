import { ArrowUpDown, CircleHelp, CirclePlus, Keyboard, ListFilter, LogOut, MapPin, Plug, Settings, Smartphone, Star, Users, createIcons } from "lucide";

const AppIcons = Object.freeze({ ArrowUpDown, CircleHelp, CirclePlus, Keyboard, ListFilter, LogOut, MapPin, Plug, Settings, Smartphone, Star, Users });

export function InitializeIcons() {
  createIcons({ icons: AppIcons });
}
