import { RapidRaterApp } from "./app/rapid-rater-app.js";
import { InitializeIcons } from "./app/icons.js";

InitializeIcons();
const App = new RapidRaterApp();
App.Start();
