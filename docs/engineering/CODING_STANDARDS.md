# Repository Coding Standards

## AUDIT-01

Commit: I'm about to commit, please follow these rules, and spawn as many specialized agents asyncly to get the job done and make sure these rules apply.

## GIT-01

DO NOT MESS WITH GIT, DON'T STAGE, DON'T UNSTAGE, DON'T TOUCH ANY GIT COMMANDS*****
(apply these to all my uncommitted code)

## VAR-01

no vars ever, in typescript must be const or let, in c# must be explicit types.

## EXCEPTION-01

minimal if not no zero try/catches

## COMMENT-01

no knockout inline comment

## CONDITION-01

if statements an never be one line like if(true) something else;  two line if statements SHOULD NOT have brackets.

## FLOW-01

return early as possible from functions.

## NAME-01

all function names in typescript or c# are capitalized, private or not.

## KNOCKOUT-01

I dont' like computed variables in knockout i like observables, can you make sure all variables are observables.

## MUTABILITY-01

Make sure all new functions or variables I've modified are static or readonly (if they can be)

## FUNCTION-01

No new functions should be over 15 line of code, including constructors, please refactor any that you see that I added.

## DEADCODE-01

Remove unused variables, delete empty functions.

## ASYNC-01

No async methods in the constructor if you're loading a awaitable function please use a promise.

## NULLABLE-01

This is .net 8 so NULLABLE MATTERS! Most properties need default values, including null, if these are nullable make sure everything knows about it, i.e. Person? jared is different than Person jared

## TYPE-01

don't use objects or dynamics, use expclit types

## MODEL-01

make sure all models are either in their own files or in one file by themselves if they are smaller models.

## CONTROLLER-01

Model.isValid states are needed in every controller function.

## NAMESPACE-01

Do not include name spaces for models, always use shortcuts, BAD: IntelliPass.Web.Data.Personnel.PersonnelDataProvider personnelDataProvider, GOOD: PersonnelDataProvider personnelDataProvider

## COLLECTION-01

in C# All List/arrays etc should be "IEnumerable or Enumerate.empty<int>(); preferred unless it cannot be

## REGION-01

no regions! i.e. #region XYZ #endregion

## FORMAT-01

all new code MUST be on one line for functions or function calls, no multiline function calls i.e. BAD:
        private static string? GetDepartureIcsRoles(
            DeparturePobRow? matchedPob,
            DeparturePresetRow? matchedPreset,
            DepartureDefaultAssignmentRow? defaultAssignment,
            IReadOnlyDictionary<int, string> pobIcsRoles,
            IReadOnlyDictionary<int, string> presetIcsRoles,
            IReadOnlyDictionary<int, string> defaultIcsRoles)
GOOD:
        private static string? GetDepartureIcsRoles(DeparturePobRow? matchedPob,DeparturePresetRow? matchedPreset, DepartureDefaultAssignmentRow? defaultAssignment, IReadOnlyDictionary<int, string> pobIcsRoles, IReadOnlyDictionary<int, string> presetIcsRoles, IReadOnlyDictionary<int, string> defaultIcsRoles)

## TERNARY-01

No overly complicated Terniary operations.

## NULLABLE-02

Any variables checked, always check if its a nullable variable if it is, check for null and return instantly OR check this variable at the end of the function and return then (doing as much logic to everything else first)

## FORMAT-02

Good:
    private BuildConflictDialogOptions(conflicts: WorkSiteScheduleEventConflict[], allowAddConflictingEvents: boolean): WorkSiteScheduleConflictDialogOptions {
        return {
            showAddConflictingButton: allowAddConflictingEvents,
            addConflicting: () => this.SaveConflictingCrewEvents(conflicts)
        };
    }
Bad: 
    private BuildConflictDialogOptions(conflicts: WorkSiteScheduleEventConflict[], allowAddConflictingEvents: boolean): WorkSiteScheduleConflictDialogOptions {
        return { showAddConflictingButton: allowAddConflictingEvents, addConflicting: () => this.SaveConflictingCrewEvents(conflicts) };
    }.
See the difference? if it is easier to read do it, but NOT with functions.

## PARAMETER-01

all new functions created must have max 7 parameters.

## DATABASE-01

Database classes MUST be in their own file by themselves.

## TYPE-02

Private sealed classes must be at the bottom, if the lines in the file are huge, put them in their own file.

## READABILITY-01

Bad:
return DoesCrewConflictPersonnelMatch(scheduleEvent, personnel, key) && scheduleEvent.ArrivalDate.Date == key.ArrivalDate.Date && scheduleEvent.DepartureDate.Date == key.DepartureDate.Date;
Good:
const hasMatchingArrival = scheduleEvent.ArrivalDate.Date == key.ArrivalDate.Date;
const hasMatchingDeparture = scheduleEvent.DepartureDate.Date == key.DepartureDate.Date
return DoesCrewConflictPersonnelMatch(scheduleEvent, personnel, key) && hasMatchingArrival && hasMatchingDeparture.
//so it is easily readable like a book.

## CALL-01

This line right here is bad, what does all this stuff going into this utils mean?
        this._utils.Confirm(message, () => this.SaveEvent(mode, false, false, false, "skip", true), () => this.IsSavingEvent(false), "Continue", "Cancel", "fa-trash", "fa-times-circle");  think of this generically, if a human reads this do they understand it without going into the function.

## LINQ-01

I prefer linqs to be on separate lines like this.
Good:
            return personnel
                .Select(personnelItem => CreatePersonnelEventFromCrewEvent(scheduleEvent.Copy(), personnelItem, crewPositionIds))
                .Where(scheduleEvent => scheduleEvent != null)
                .Cast<WorkSiteScheduleEvent>()
                .ToList();
Bad:
            return personnel.Select(personnelItem => CreatePersonnelEventFromCrewEvent(scheduleEvent.Copy(), personnelItem, crewPositionIds)).Where(scheduleEvent => scheduleEvent != null).Cast<WorkSiteScheduleEvent>().ToList();

## OPTIMIZATION-01

You are allowed to optimize, BUT ONLY if you can guarantee the same result is produced through unit tests before/after on that function.

## CONSTANT-01

No "magic strings" if you see a string mentioned more than once in the code, make it a variable. If it is part of a bigger theme make it an Enum.

## DESIGN-01

Look for places for more KISS and DRY techniques using generics. Less code = better.

## FILE-01

No files over 1k line of code.

## SCOPE-01

AGAIN ******* can you verify all **AND ONLY** my uncommitted changes NOT all code. ONLY code I touched.
--------- Do this now, do not stop until it is finished.
