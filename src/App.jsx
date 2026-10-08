import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Plus,
  Flame,
  Trash2,
  RotateCcw,
  Check,
  X,
  GripVertical,
  BarChart3,
  CalendarDays,
  Archive,
  Settings,
  LogOut,
} from "lucide-react";

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getDocsFromCache,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import {
  auth,
  googleProvider,
  db,
} from "./firebase";

/* =========================================================
   CONSTANTS
   ========================================================= */

const today = new Date()
  .toISOString()
  .slice(0, 10);

const initialHabits = [
  {
    id: "study",
    name: "Study",
    type: "numeric",
    unit: "hours",
    referenceAmount: 4,
    order: 0,
    deleted: false,
    records: {
      [today]: 3,
    },
  },

  {
    id: "exercise",
    name: "Exercise",
    type: "boolean",
    unit: "",
    referenceAmount: null,
    order: 1,
    deleted: false,
    records: {
      [today]: true,
    },
  },
];

/* =========================================================
   FIRESTORE HELPERS
   ========================================================= */

function getHabitsCollection(userId) {
  return collection(
    db,
    "users",
    userId,
    "habits"
  );
}

function getHabitDocument(
  userId,
  habitId
) {
  return doc(
    db,
    "users",
    userId,
    "habits",
    habitId
  );
}

function getRecordsCollection(
  userId,
  habitId
) {
  return collection(
    db,
    "users",
    userId,
    "habits",
    habitId,
    "records"
  );
}

function getRecordDocument(
  userId,
  habitId,
  date
) {
  return doc(
    db,
    "users",
    userId,
    "habits",
    habitId,
    "records",
    date
  );
}

/* =========================================================
   LEGACY RECORD MIGRATION
   ========================================================= */

async function migrateLegacyRecords(
  userId,
  habitId,
  records
) {
  const entries = Object.entries(
    records || {}
  );

  if (entries.length === 0) {
    return;
  }

  const recordsPath =
    getRecordsCollection(
      userId,
      habitId
    );

  const chunkSize = 400;

  for (
    let start = 0;
    start < entries.length;
    start += chunkSize
  ) {
    const chunk = entries.slice(
      start,
      start + chunkSize
    );

    const batch =
      writeBatch(db);

    for (const [
      date,
      value,
    ] of chunk) {
      batch.set(
        doc(recordsPath, date),
        {
          value,
        }
      );
    }

    await batch.commit();
  }

  await setDoc(
    getHabitDocument(
      userId,
      habitId
    ),
    {
      records: deleteField(),
    },
    {
      merge: true,
    }
  );
}

/* =========================================================
   LOAD RECORDS
   ========================================================= */

async function loadHabitRecords(
  userId,
  habitId,
  source = "server"
) {
  const recordsRef =
    getRecordsCollection(
      userId,
      habitId
    );

  let snapshot;

  if (source === "cache") {
    snapshot =
      await getDocsFromCache(
        recordsRef
      );
  } else {
    snapshot =
      await getDocs(recordsRef);
  }

  const records = {};

  snapshot.forEach(
    (recordDoc) => {
      const data =
        recordDoc.data();

      records[recordDoc.id] =
        data.value;
    }
  );

  return records;
}

/* =========================================================
   LOAD HABITS FROM FIRESTORE
   ========================================================= */

async function loadHabitsFromSource(
  userId,
  source
) {
  const habitsRef =
    getHabitsCollection(userId);

  let snapshot;

  if (source === "cache") {
    snapshot =
      await getDocsFromCache(
        habitsRef
      );
  } else {
    snapshot =
      await getDocs(habitsRef);
  }

  const loadedHabits = [];

  for (const item of snapshot.docs) {
    const data = item.data();

    /*
      Older versions stored records directly
      inside the habit document.

      We continue supporting that format so
      existing user data is not lost.
    */
    if (
      data.records &&
      typeof data.records ===
        "object"
    ) {
      loadedHabits.push({
        id: item.id,
        ...data,
        records: {
          ...data.records,
        },
      });

      /*
        Migration is handled separately after
        the online server refresh.
      */
      continue;
    }

    let records = {};

    try {
      records =
        await loadHabitRecords(
          userId,
          item.id,
          source
        );
    } catch (error) {
      console.warn(
        `Could not load records for ${item.id}:`,
        error
      );
    }

    loadedHabits.push({
      id: item.id,
      ...data,
      records,
    });
  }

  return {
    habits: loadedHabits,
    empty: snapshot.empty,
  };
}

/* =========================================================
   HABIT HELPERS
   ========================================================= */

function intensity(
  value,
  reference
) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !reference
  ) {
    return 0;
  }

  const ratio =
    Number(value) /
    Number(reference);

  if (ratio >= 1) return 4;
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.5) return 2;
  if (ratio > 0) return 1;

  return 0;
}

function getStreak(habit) {
  let date = new Date();

  let streak = 0;

  while (true) {
    const key = date
      .toISOString()
      .slice(0, 10);

    const value =
      habit.records?.[key];

    const successful =
      habit.type === "boolean"
        ? value === true
        : Number(value || 0) >=
          Number(
            habit.referenceAmount
          );

    if (!successful) {
      break;
    }

    streak++;

    date.setDate(
      date.getDate() - 1
    );
  }

  return streak;
}

/* =========================================================
   CALENDAR
   ========================================================= */

function Calendar({ habit }) {
  const days = useMemo(() => {
    const result = [];

    const now = new Date();

    for (
      let i = 89;
      i >= 0;
      i--
    ) {
      const date =
        new Date(now);

      date.setDate(
        now.getDate() - i
      );

      result.push(date);
    }

    return result;
  }, []);

  return (
    <div className="calendar-wrapper">
      <div className="calendar">
        {days.map((date) => {
          const key = date
            .toISOString()
            .slice(0, 10);

          const value =
            habit.records?.[key];

          let level = 0;

          if (
            habit.type ===
            "boolean"
          ) {
            level = value ? 4 : 0;
          } else {
            level = intensity(
              value,
              habit.referenceAmount
            );
          }

          return (
            <div
              key={key}
              className={`day level-${level}`}
              title={`${key}: ${
                habit.type ===
                "boolean"
                  ? value
                    ? "Done"
                    : "Not done"
                  : `${value || 0} ${
                      habit.unit ||
                      ""
                    }`
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================
   HABIT CARD
   ========================================================= */

function HabitCard({
  habit,
  onToggleToday,
  onDelete,
  onEdit,
}) {
  const todayValue =
    habit.records?.[today];

  const streak =
    getStreak(habit);

  return (
    <div className="habit-card">
      <div className="habit-header">
        <div className="habit-title-area">
          <GripVertical
            className="drag-icon"
            size={19}
          />

          <div>
            <h2>
              {habit.name}
            </h2>

            {habit.type ===
            "numeric" ? (
              <p>
                Reference:{" "}
                {
                  habit.referenceAmount
                }{" "}
                {habit.unit}
              </p>
            ) : (
              <p>
                Yes / No habit
              </p>
            )}
          </div>
        </div>

        <div className="habit-actions">
          <button
            onClick={() =>
              onEdit(habit)
            }
            title="Edit"
          >
            <Settings
              size={17}
            />
          </button>

          <button
            onClick={() =>
              onDelete(habit.id)
            }
            title="Move to bin"
          >
            <Trash2
              size={17}
            />
          </button>
        </div>
      </div>

      <Calendar
        habit={habit}
      />

      <div className="habit-footer">
        <div className="streak">
          <Flame size={17} />

          <strong>
            {streak}
          </strong>

          <span>
            day streak
          </span>
        </div>

        <button
          className="today-button"
          onClick={() =>
            onToggleToday(habit)
          }
        >
          {habit.type ===
          "boolean" ? (
            todayValue ? (
              <>
                <Check
                  size={17}
                />

                Done
              </>
            ) : (
              <>
                <X
                  size={17}
                />

                Mark done
              </>
            )
          ) : (
            <>
              Today:{" "}
              {todayValue || 0}{" "}
              {habit.unit}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   LOGIN SCREEN
   ========================================================= */

function LoginScreen({
  onLogin,
}) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <CalendarDays
            size={32}
          />
        </div>

        <h1>
          Habit Tracker
        </h1>

        <p>
          Track your habits,
          build consistency,
          and see your progress.
        </p>

        <button
          className="google-login-button"
          onClick={onLogin}
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   MAIN APP
   ========================================================= */

function App() {
  const [user, setUser] =
    useState(undefined);

  const [isOnline, setIsOnline] =
    useState(
      navigator.onLine
    );

  const [
    syncStatus,
    setSyncStatus,
  ] = useState("Starting...");

  const [habits, setHabits] =
    useState([]);

  const [
    loadingHabits,
    setLoadingHabits,
  ] = useState(false);

  const [view, setView] =
    useState("habits");

  const [showAdd, setShowAdd] =
    useState(false);

  const [
    editingHabit,
    setEditingHabit,
  ] = useState(null);

  /* =======================================================
     AUTH STATE
     ======================================================= */

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
        auth,
        (currentUser) => {
          setUser(
            currentUser
          );
        },
        (error) => {
          console.error(
            "AUTH ERROR:",
            error
          );

          setUser(null);
        }
      );

    return unsubscribe;
  }, []);

  /* =======================================================
     ONLINE / OFFLINE STATUS
     ======================================================= */

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);

      setSyncStatus(
        "Offline — saved locally"
      );
    }

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );

      window.removeEventListener(
        "offline",
        handleOffline
      );
    };
  }, []);

  /* =======================================================
     LOAD LOCAL CACHE FIRST
     ======================================================= */

  async function loadLocalHabits(
    currentUser
  ) {
    try {
      const result =
        await loadHabitsFromSource(
          currentUser.uid,
          "cache"
        );

      setHabits(
        result.habits
      );

      return result;
    } catch (error) {
      console.warn(
        "No local Firestore cache available:",
        error
      );

      return {
        habits: [],
        empty: true,
      };
    }
  }

  /* =======================================================
     REFRESH FROM SERVER
     ======================================================= */

  async function refreshFromServer(
    currentUser
  ) {
    if (!navigator.onLine) {
      return;
    }

    try {
      setSyncStatus(
        "Syncing..."
      );

      const result =
        await loadHabitsFromSource(
          currentUser.uid,
          "server"
        );

      let serverHabits =
        result.habits;

      /*
        If this is genuinely a new account,
        create the initial habits.
      */
      if (
        result.empty
      ) {
        for (
          const habit of initialHabits
        ) {
          const {
            records,
            ...habitData
          } = habit;

          /*
            Firestore persistence makes this
            write immediately available locally
            even if connectivity disappears.
          */
          setDoc(
            getHabitDocument(
              currentUser.uid,
              habit.id
            ),
            habitData
          ).catch((error) => {
            console.error(
              "Initial habit sync failed:",
              error
            );
          });

          for (const [
            date,
            value,
          ] of Object.entries(
            records
          )) {
            setDoc(
              getRecordDocument(
                currentUser.uid,
                habit.id,
                date
              ),
              {
                value,
              }
            ).catch((error) => {
              console.error(
                "Initial record sync failed:",
                error
              );
            });
          }
        }

        serverHabits =
          initialHabits.map(
            (habit) => ({
              ...habit,
              records: {
                ...habit.records,
              },
            })
          );
      }

      /*
        Migrate old embedded records.
      */
      for (
        const habit of serverHabits
      ) {
        if (
          habit.records &&
          typeof habit.records ===
            "object"
        ) {
          /*
            If the server version came from
            the old embedded-record format,
            migrate those records.
          */
          try {
            const habitDoc =
              await getDocs(
                getRecordsCollection(
                  currentUser.uid,
                  habit.id
                )
              );

            /*
              Only migrate if the records
              subcollection is empty.
            */
            if (
              habitDoc.empty
            ) {
              await migrateLegacyRecords(
                currentUser.uid,
                habit.id,
                habit.records
              );
            }
          } catch (error) {
            console.warn(
              "Legacy migration skipped:",
              error
            );
          }
        }
      }

      /*
        Reload after migration so the app uses
        the new records/{date} structure.
      */
      try {
        const refreshed =
          await loadHabitsFromSource(
            currentUser.uid,
            "server"
          );

        serverHabits =
          refreshed.habits;
      } catch (error) {
        console.warn(
          "Final refresh failed:",
          error
        );
      }

      setHabits(
        serverHabits
      );

      setSyncStatus(
        "Synced"
      );
    } catch (error) {
      console.error(
        "Server refresh failed:",
        error
      );

      /*
        Do NOT erase local data if server
        access fails.
      */

      setSyncStatus(
        navigator.onLine
          ? "Using local data"
          : "Offline — saved locally"
      );
    }
  }

  /* =======================================================
     INITIAL DATA LOAD
     ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function initializeUser() {
      if (!user) {
        setHabits([]);
        setLoadingHabits(false);
        setSyncStatus(
          "Not signed in"
        );
        return;
      }

      /*
        Important:
        We do NOT wait for the server before
        displaying the app.
      */
      setLoadingHabits(true);

      const local =
        await loadLocalHabits(
          user
        );

      if (cancelled) {
        return;
      }

      setHabits(
        local.habits
      );

      /*
        Local cache has now loaded, so
        the UI can immediately render.
      */
      setLoadingHabits(false);

      if (
        navigator.onLine
      ) {
        setSyncStatus(
          "Syncing..."
        );

        /*
          Background synchronization.
          The UI does not wait for this.
        */
        refreshFromServer(
          user
        );
      } else {
        setSyncStatus(
          local.habits.length > 0
            ? "Offline — saved locally"
            : "Offline — no local data"
        );
      }
    }

    initializeUser();

    return () => {
      cancelled = true;
    };
  }, [user]);

  /* =======================================================
     SYNC WHEN CONNECTION RETURNS
     ======================================================= */

  useEffect(() => {
    if (!user) {
      return;
    }

    function handleReconnect() {
      refreshFromServer(
        user
      );
    }

    window.addEventListener(
      "online",
      handleReconnect
    );

    return () => {
      window.removeEventListener(
        "online",
        handleReconnect
      );
    };
  }, [user]);

  /* =======================================================
     GOOGLE LOGIN
     ======================================================= */

  async function handleGoogleLogin() {
    try {
      await signInWithPopup(
        auth,
        googleProvider
      );
    } catch (error) {
      console.error(
        "Google login failed:",
        error
      );

      alert(
        `Google login failed: ${error.message}`
      );
    }
  }

  /* =======================================================
     LOGOUT
     ======================================================= */

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );

      alert(
        `Logout failed: ${error.message}`
      );
    }
  }

  /* =======================================================
     SAVE HABIT
     ======================================================= */

  async function saveHabit(
    habit
  ) {
    if (!user) {
      return;
    }

    const {
      records,
      ...habitData
    } = habit;

    /*
      Update UI immediately.
    */
    setHabits((current) => {
      const exists =
        current.some(
          (item) =>
            item.id ===
            habit.id
        );

      if (exists) {
        return current.map(
          (item) =>
            item.id ===
            habit.id
              ? habit
              : item
        );
      }

      return [
        ...current,
        habit,
      ];
    });

    /*
      Do not await this.

      Firestore persistence stores the
      mutation locally immediately and
      synchronizes it with the server
      when the connection returns.
    */
    setDoc(
      getHabitDocument(
        user.uid,
        habit.id
      ),
      habitData,
      {
        merge: true,
      }
    )
      .then(() => {
        setSyncStatus(
          "Synced"
        );
      })
      .catch((error) => {
        console.error(
          "Habit sync failed:",
          error
        );

        if (
          !navigator.onLine
        ) {
          setSyncStatus(
            "Offline — saved locally"
          );
        } else {
          setSyncStatus(
            "Sync pending"
          );
        }
      });
  }

  /* =======================================================
     SAVE TODAY'S RECORD
     ======================================================= */

  async function toggleToday(
    habit
  ) {
    if (!user) {
      return;
    }

    let value;

    if (
      habit.type ===
      "boolean"
    ) {
      value =
        !habit.records?.[
          today
        ];
    } else {
      const current =
        Number(
          habit.records?.[
            today
          ] || 0
        );

      const amount =
        prompt(
          `Enter today's amount in ${habit.unit}:`,
          current
        );

      if (amount === null) {
        return;
      }

      const numericAmount =
        Number(amount);

      if (
        Number.isNaN(
          numericAmount
        ) ||
        numericAmount < 0
      ) {
        alert(
          "Please enter a valid number."
        );

        return;
      }

      value =
        numericAmount;
    }

    /*
      Update UI immediately.
    */
    setHabits((current) =>
      current.map((item) => {
        if (
          item.id !==
          habit.id
        ) {
          return item;
        }

        return {
          ...item,
          records: {
            ...item.records,
            [today]: value,
          },
        };
      })
    );

    /*
      Firestore handles offline
      persistence and later sync.
    */
    setDoc(
      getRecordDocument(
        user.uid,
        habit.id,
        today
      ),
      {
        value,
      }
    )
      .then(() => {
        setSyncStatus(
          "Synced"
        );
      })
      .catch((error) => {
        console.error(
          "Record sync failed:",
          error
        );

        setSyncStatus(
          navigator.onLine
            ? "Sync pending"
            : "Offline — saved locally"
        );
      });
  }

  /* =======================================================
     MOVE TO BIN
     ======================================================= */

  async function moveToBin(
    id
  ) {
    if (
      !confirm(
        "Move this habit to the bin? Its data will be preserved."
      )
    ) {
      return;
    }

    const habit =
      habits.find(
        (item) =>
          item.id === id
      );

    if (!habit) {
      return;
    }

    await saveHabit({
      ...habit,
      deleted: true,
      deletedAt:
        new Date().toISOString(),
    });
  }

  /* =======================================================
     RESTORE
     ======================================================= */

  async function restore(
    id
  ) {
    const habit =
      habits.find(
        (item) =>
          item.id === id
      );

    if (!habit) {
      return;
    }

    await saveHabit({
      ...habit,
      deleted: false,
      deletedAt: null,
    });
  }

  /* =======================================================
     PERMANENT DELETE
     ======================================================= */

  async function permanentlyDelete(
    id
  ) {
    if (
      !confirm(
        "Permanently delete this habit and ALL of its data? This cannot be undone."
      )
    ) {
      return;
    }

    /*
      Permanent deletion is different from
      ordinary offline writes.

      We need to know every record document.
      Therefore we require connectivity here
      to avoid leaving unknown remote records.
    */
    if (!navigator.onLine) {
      alert(
        "Permanent deletion requires an internet connection. The habit can remain in the Bin until you are online."
      );

      return;
    }

    try {
      const recordsSnapshot =
        await getDocs(
          getRecordsCollection(
            user.uid,
            id
          )
        );

      const batch =
        writeBatch(db);

      recordsSnapshot.forEach(
        (recordDoc) => {
          batch.delete(
            recordDoc.ref
          );
        }
      );

      await batch.commit();

      await deleteDoc(
        getHabitDocument(
          user.uid,
          id
        )
      );

      setHabits((current) =>
        current.filter(
          (habit) =>
            habit.id !== id
        )
      );

      setSyncStatus(
        "Synced"
      );
    } catch (error) {
      console.error(
        "Permanent deletion failed:",
        error
      );

      alert(
        `Failed to permanently delete habit: ${error.message}`
      );
    }
  }

  /* =======================================================
     ADD HABIT
     ======================================================= */

  async function addHabit(
    data
  ) {
    const newHabit = {
      ...data,
      id: crypto.randomUUID(),
      order: habits.length,
      deleted: false,
      records: {},
    };

    await saveHabit(
      newHabit
    );

    setShowAdd(false);
  }

  /* =======================================================
     UPDATE HABIT
     ======================================================= */

  async function updateHabit(
    data
  ) {
    const existing =
      habits.find(
        (habit) =>
          habit.id ===
          data.id
      );

    if (!existing) {
      return;
    }

    /*
      IMPORTANT:
      The existing records are preserved.
      Changing referenceAmount therefore
      automatically changes the displayed
      historical intensity without changing
      the stored raw values.
    */
    await saveHabit({
      ...existing,
      ...data,
    });

    setEditingHabit(null);
  }

  /* =======================================================
     MOVE HABIT UP / DOWN
     ======================================================= */

  async function moveHabit(
    index,
    direction
  ) {
    const sorted = [
      ...activeHabits,
    ];

    const target =
      index + direction;

    if (
      target < 0 ||
      target >=
        sorted.length
    ) {
      return;
    }

    [
      sorted[index],
      sorted[target],
    ] = [
      sorted[target],
      sorted[index],
    ];

    for (
      let i = 0;
      i < sorted.length;
      i++
    ) {
      const updated = {
        ...sorted[i],
        order: i,
      };

      await saveHabit(
        updated
      );
    }
  }

  /* =======================================================
     INITIAL AUTH LOADING
     ======================================================= */

  if (user === undefined) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <p>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  /* =======================================================
     NOT LOGGED IN
     ======================================================= */

  if (!user) {
    return (
      <LoginScreen
        onLogin={
          handleGoogleLogin
        }
      />
    );
  }

  /* =======================================================
     SORT HABITS
     ======================================================= */

  const activeHabits =
    habits
      .filter(
        (habit) =>
          !habit.deleted
      )
      .sort(
        (a, b) =>
          Number(a.order || 0) -
          Number(b.order || 0)
      );

  const deletedHabits =
    habits.filter(
      (habit) =>
        habit.deleted
    );

  /* =======================================================
     MAIN UI
     ======================================================= */

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>
            Habit Tracker
          </h1>

          <p>
            {new Date().toLocaleDateString(
              undefined,
              {
                weekday:
                  "long",
                month:
                  "long",
                day: "numeric",
              }
            )}
          </p>

          <small>
            {user.displayName ||
              user.email}
          </small>
        </div>

        <div className="sync-status-container">
          <div
            className={`sync-status ${
              isOnline
                ? "online"
                : "offline"
            }`}
          >
            <span className="sync-dot" />

            {syncStatus}
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className="add-button"
            onClick={() =>
              setShowAdd(true)
            }
          >
            <Plus size={20} />

            <span>
              Add Habit
            </span>
          </button>

          <button
            className="logout-button"
            onClick={
              handleLogout
            }
            title="Sign out"
          >
            <LogOut
              size={18}
            />
          </button>
        </div>
      </header>

      <nav className="navigation">
        <button
          className={
            view === "habits"
              ? "active"
              : ""
          }
          onClick={() =>
            setView("habits")
          }
        >
          <CalendarDays
            size={18}
          />

          Habits
        </button>

        <button
          className={
            view ===
            "statistics"
              ? "active"
              : ""
          }
          onClick={() =>
            setView(
              "statistics"
            )
          }
        >
          <BarChart3
            size={18}
          />

          Statistics
        </button>

        <button
          className={
            view === "bin"
              ? "active"
              : ""
          }
          onClick={() =>
            setView("bin")
          }
        >
          <Archive
            size={18}
          />

          Bin
        </button>
      </nav>

      <main>
        {loadingHabits ? (
          <div className="empty">
            <h2>
              Loading habits...
            </h2>

            <p>
              Loading local data...
            </p>
          </div>
        ) : (
          <>
            {view ===
              "habits" && (
              <section>
                {activeHabits.length ===
                0 ? (
                  <div className="empty">
                    <h2>
                      No habits yet
                    </h2>

                    <p>
                      Create your
                      first habit
                      to get
                      started.
                    </p>

                    <button
                      onClick={() =>
                        setShowAdd(
                          true
                        )
                      }
                    >
                      <Plus
                        size={18}
                      />

                      Add Habit
                    </button>
                  </div>
                ) : (
                  activeHabits.map(
                    (
                      habit,
                      index
                    ) => (
                      <div
                        className="sortable"
                        key={
                          habit.id
                        }
                      >
                        <HabitCard
                          habit={
                            habit
                          }
                          onToggleToday={
                            toggleToday
                          }
                          onDelete={
                            moveToBin
                          }
                          onEdit={
                            setEditingHabit
                          }
                        />

                        <div className="move-controls">
                          <button
                            disabled={
                              index ===
                              0
                            }
                            onClick={() =>
                              moveHabit(
                                index,
                                -1
                              )
                            }
                          >
                            ↑
                          </button>

                          <button
                            disabled={
                              index ===
                              activeHabits.length -
                                1
                            }
                            onClick={() =>
                              moveHabit(
                                index,
                                1
                              )
                            }
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    )
                  )
                )}
              </section>
            )}

            {view ===
              "statistics" && (
              <section className="panel">
                <h2>
                  Statistics
                </h2>

                {activeHabits.map(
                  (habit) => {
                    const values =
                      Object.values(
                        habit.records ||
                          {}
                      );

                    const total =
                      habit.type ===
                      "boolean"
                        ? values.filter(
                            Boolean
                          ).length
                        : values.reduce(
                            (
                              a,
                              b
                            ) =>
                              a +
                              Number(
                                b || 0
                              ),
                            0
                          );

                    return (
                      <div
                        className="stat-row"
                        key={
                          habit.id
                        }
                      >
                        <strong>
                          {
                            habit.name
                          }
                        </strong>

                        <span>
                          {habit.type ===
                          "boolean"
                            ? `${total} completed days`
                            : `${total} ${habit.unit} total`}
                        </span>
                      </div>
                    );
                  }
                )}
              </section>
            )}

            {view === "bin" && (
              <section className="panel">
                <h2>
                  Bin
                </h2>

                {deletedHabits.length ===
                0 ? (
                  <div className="empty-small">
                    The bin is
                    empty.
                  </div>
                ) : (
                  deletedHabits.map(
                    (habit) => (
                      <div
                        className="bin-row"
                        key={
                          habit.id
                        }
                      >
                        <div>
                          <strong>
                            {
                              habit.name
                            }
                          </strong>

                          <small>
                            Deleted{" "}
                            {habit.deletedAt
                              ? new Date(
                                  habit.deletedAt
                                ).toLocaleDateString()
                              : ""}
                          </small>
                        </div>

                        <div>
                          <button
                            onClick={() =>
                              restore(
                                habit.id
                              )
                            }
                          >
                            <RotateCcw
                              size={16}
                            />

                            Restore
                          </button>

                          <button
                            className="danger"
                            onClick={() =>
                              permanentlyDelete(
                                habit.id
                              )
                            }
                          >
                            <Trash2
                              size={16}
                            />

                            Delete
                            permanently
                          </button>
                        </div>
                      </div>
                    )
                  )
                )}
              </section>
            )}
          </>
        )}
      </main>

      {(showAdd ||
        editingHabit) && (
        <HabitModal
          habit={
            editingHabit
          }
          onClose={() => {
            setShowAdd(false);
            setEditingHabit(
              null
            );
          }}
          onSave={
            editingHabit
              ? updateHabit
              : addHabit
          }
        />
      )}
    </div>
  );
}

/* =========================================================
   HABIT MODAL
   ========================================================= */

function HabitModal({
  habit,
  onClose,
  onSave,
}) {
  const [name, setName] =
    useState(
      habit?.name || ""
    );

  const [type, setType] =
    useState(
      habit?.type ||
        "numeric"
    );

  const [unit, setUnit] =
    useState(
      habit?.unit ||
        "hours"
    );

  const [
    referenceAmount,
    setReferenceAmount,
  ] = useState(
    habit?.referenceAmount ||
      1
  );

  function submit(e) {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    onSave({
      ...(habit || {}),
      name: name.trim(),
      type,
      unit:
        type === "numeric"
          ? unit
          : "",
      referenceAmount:
        type === "numeric"
          ? Number(
              referenceAmount
            )
          : null,
    });
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={submit}
      >
        <h2>
          {habit
            ? "Edit Habit"
            : "Create Habit"}
        </h2>

        <label>
          Habit name

          <input
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
            }
            placeholder="e.g. Study"
            autoFocus
          />
        </label>

        <label>
          Habit type

          <select
            value={type}
            onChange={(e) =>
              setType(
                e.target.value
              )
            }
          >
            <option value="numeric">
              Numeric
            </option>

            <option value="boolean">
              Yes / No
            </option>
          </select>
        </label>

        {type ===
          "numeric" && (
          <>
            <label>
              Unit

              <input
                value={unit}
                onChange={(e) =>
                  setUnit(
                    e.target.value
                  )
                }
                placeholder="hours"
              />
            </label>

            <label>
              Reference amount

              <input
                type="number"
                min="0.01"
                step="any"
                value={
                  referenceAmount
                }
                onChange={(e) =>
                  setReferenceAmount(
                    e.target.value
                  )
                }
              />
            </label>

            {habit && (
              <p className="modal-note">
                Changing the
                reference will
                recalculate the
                intensity of all
                historical days.
              </p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="primary"
            type="submit"
          >
            {habit
              ? "Save changes"
              : "Create habit"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
