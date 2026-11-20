import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { NavLink, useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import {
  blockPhone,
  listBlockedPhones,
  unblockPhone,
} from "../services/blockedPhoneService";
import {
  listPhoneRestorationRequests,
  resolvePhoneRestorationRequest,
} from "../services/phoneRestorationService";
import PhoneBlockControl from "../components/PhoneBlockControl";
import { normalizePHPhone } from "../utils/phoneUtils.js";
import "../styles/AdminUsers.css";
import "../styles/AdminSidebar.css";

const PHONE_EDIT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const BLOCKED_PHONE_PAGE_SIZE = 6;
const CUSTOMER_PAGE_SIZE = 10;

const formatDate = (timestamp) => {
  const date = typeof timestamp?.toDate === "function"
    ? timestamp.toDate()
    : timestamp instanceof Date
      ? timestamp
      : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getUserName = (user) =>
  user.name ||
  user.fullName ||
  user.displayName ||
  "Unnamed user";

const getUserRole = (user) =>
  String(user.role || "customer").toLowerCase();

const getUserPhone = (user) =>
  String(user.phoneNumber || user.phone || "").trim();

const getUserRegistrationTime = (user) => {
  const createdAt = user.createdAt;
  const date = typeof createdAt?.toDate === "function"
    ? createdAt.toDate()
    : createdAt instanceof Date
      ? createdAt
      : typeof createdAt === "string" || typeof createdAt === "number"
        ? new Date(createdAt)
        : null;

  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.getTime()
    : 0;
};

const getCustomerName = (user) => {
  if (!user) return "";
  const fullName = [
    user.firstName,
    user.middleInitial,
    user.lastName,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  return fullName || [
    user.name,
    user.fullName,
    user.displayName,
  ].find((name) => typeof name === "string" && name.trim())?.trim() || "";
};

const getCustomerAddress = (user) => {
  const address = user?.deliveryAddress;
  if (typeof address === "string") return address.trim();
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return "";
  }

  const parts = [
    address.houseNumberStreet,
    address.streetPurok,
    address.barangay,
    address.municipalityCity,
    address.province,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  return parts.filter((part, index) =>
    parts.findIndex((candidate) =>
      candidate.toLowerCase() === part.toLowerCase(),
    ) === index,
  ).join(", ");
};

const getPhoneCooldownEnd = (user) => {
  const updatedAt = typeof user.phoneUpdatedAt?.toDate === "function"
    ? user.phoneUpdatedAt.toDate()
    : user.phoneUpdatedAt instanceof Date
      ? user.phoneUpdatedAt
      : null;

  return updatedAt instanceof Date && !Number.isNaN(updatedAt.getTime())
    ? updatedAt.getTime() + PHONE_EDIT_COOLDOWN_MS
    : null;
};

const isPhoneCooldownActive = (user, now) => {
  if (!getUserPhone(user)) return false;
  const cooldownEnd = getPhoneCooldownEnd(user);
  return cooldownEnd === null || cooldownEnd > now;
};

const createPhoneCooldownResetTimestamp = () =>
  Timestamp.fromMillis(Date.now() - 31 * 24 * 60 * 60 * 1000);

const fallbackCopyText = (text) => {
  const copyField = document.createElement("textarea");
  copyField.value = text;
  copyField.setAttribute("readonly", "");
  copyField.style.position = "fixed";
  copyField.style.opacity = "0";

  try {
    document.body.appendChild(copyField);
    copyField.select();
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy failed");
    }
  } finally {
    copyField.remove();
  }
};

const getInitials = (user) => {
  const name = getUserName(user);

  if (name === "Unnamed user") {
    return "U";
  }

  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

function AdminUsers() {
  const navigate = useNavigate();
  const manualReasonInputRef = useRef(null);
  const copyFeedbackTimerRef = useRef(null);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [blockedPhones, setBlockedPhones] = useState([]);
  const [blockedPhonesError, setBlockedPhonesError] = useState("");
  const [blockedPhonesLoading, setBlockedPhonesLoading] = useState(true);
  const [blockedPhoneSearch, setBlockedPhoneSearch] = useState("");
  const [blockedPhonePage, setBlockedPhonePage] = useState(1);
  const [restorationRequests, setRestorationRequests] = useState([]);
  const [restorationRequestsError, setRestorationRequestsError] = useState("");
  const [restorationRequestsLoading, setRestorationRequestsLoading] =
    useState(true);
  const [resolvingRestorationId, setResolvingRestorationId] = useState("");
  const [unblockingPhone, setUnblockingPhone] = useState("");
  const [resettingCooldownUid, setResettingCooldownUid] = useState("");
  const [blockingPhone, setBlockingPhone] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualBlockError, setManualBlockError] = useState("");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [customerPage, setCustomerPage] = useState(1);
  const [copyFeedback, setCopyFeedback] = useState(null);

  useEffect(
    () => () => window.clearTimeout(copyFeedbackTimerRef.current),
    [],
  );

  const loadUsers = useCallback(async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "users")
      );

      const usersList = snapshot.docs
        .map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        }))
        .sort((firstUser, secondUser) => {
          const firstDate = firstUser.createdAt?.toDate
            ? firstUser.createdAt.toDate()
            : new Date(0);

          const secondDate = secondUser.createdAt?.toDate
            ? secondUser.createdAt.toDate()
            : new Date(0);

          return secondDate - firstDate;
        });

      setUsers(usersList);
      return true;
    } catch (loadError) {
      console.error("Error loading users:", loadError);
      setError("Unable to load users. Please try again.");
      return false;
    }
  }, []);

  const loadBlockedPhones = useCallback(async () => {
    setBlockedPhonesLoading(true);
    try {
      setBlockedPhonesError("");
      setBlockedPhones(await listBlockedPhones(db));
      return true;
    } catch (loadError) {
      console.error("Error loading blocked phone numbers:", loadError);
      setBlockedPhonesError(
        "Unable to load blocked phone numbers. Please try again.",
      );
      return false;
    } finally {
      setBlockedPhonesLoading(false);
    }
  }, []);

  const loadPhoneRestorationRequests = useCallback(async () => {
    setRestorationRequestsLoading(true);
    try {
      setRestorationRequestsError("");
      setRestorationRequests(await listPhoneRestorationRequests(db));
      return true;
    } catch (loadError) {
      console.error("Error loading phone restoration requests:", loadError);
      setRestorationRequestsError(
        "Unable to load phone restoration requests. Please try again.",
      );
      return false;
    } finally {
      setRestorationRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login", { replace: true });
          return;
        }

        try {
          setLoading(true);

          const currentUserSnapshot = await getDoc(
            doc(db, "users", currentUser.uid)
          );

          if (!currentUserSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login", { replace: true });
            return;
          }

          const currentUserData =
            currentUserSnapshot.data();

          if (currentUserData.role !== "admin") {
            alert("Access denied. Admin account required.");
            navigate("/customer", { replace: true });
            return;
          }

          await Promise.all([
            loadUsers(),
            loadBlockedPhones(),
            loadPhoneRestorationRequests(),
          ]);
        } catch (accessError) {
          console.error(
            "Error checking admin access:",
            accessError
          );

          setError(
            "Unable to verify administrator access."
          );
        } finally {
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [loadBlockedPhones, loadPhoneRestorationRequests, loadUsers, navigate]);

  useEffect(() => {
    const timerId = window.setInterval(
      () => setCurrentTime(Date.now()),
      60_000,
    );

    return () => window.clearInterval(timerId);
  }, []);

  const customerUsers = useMemo(
    () => users.filter((user) => getUserRole(user) === "customer"),
    [users],
  );
  const customersByPhone = useMemo(
    () => new Map(
      customerUsers
        .map((customer) => [
          normalizePHPhone(getUserPhone(customer)),
          customer,
        ])
        .filter(([phone]) => phone),
    ),
    [customerUsers],
  );
  const blockedPhoneNumbers = useMemo(
    () => new Set(blockedPhones.map((blockedPhone) => blockedPhone.id)),
    [blockedPhones],
  );

  const statistics = useMemo(() => {
    return {
      customers: customerUsers.length,
      activeCooldowns: customerUsers.filter((user) =>
        isPhoneCooldownActive(user, currentTime),
      ).length,
      blockedNumbers: blockedPhones.length,
    };
  }, [blockedPhones.length, currentTime, customerUsers]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();
    const compactPhoneSearch = normalizedSearch.replace(/\D/g, "");
    const phoneSearch = compactPhoneSearch.startsWith("63")
      ? `0${compactPhoneSearch.slice(2)}`
      : compactPhoneSearch;

    return customerUsers
      .filter((user) => {
        const name = getUserName(user);
        const email = user.email || "No email";
        const phone = getUserPhone(user);
        const normalizedPhone = normalizePHPhone(phone);
        const cooldownActive = isPhoneCooldownActive(user, currentTime);
        const isBlocked = blockedPhoneNumbers.has(normalizedPhone);

        const searchableText = `
          ${name}
          ${email}
          ${phone}
          ${normalizedPhone}
          ${user.id}
        `.toLowerCase();

        const matchesSearch =
          normalizedSearch === "" ||
          searchableText.includes(normalizedSearch) ||
          Boolean(phoneSearch && normalizedPhone.includes(phoneSearch));
        const matchesFilter = customerFilter === "all"
          || (customerFilter === "cooldown" && cooldownActive)
          || (customerFilter === "blocked" && isBlocked);

        return matchesFilter && matchesSearch;
      })
      .sort((firstUser, secondUser) => {
        const firstHasPhone = Boolean(
          normalizePHPhone(getUserPhone(firstUser)),
        );
        const secondHasPhone = Boolean(
          normalizePHPhone(getUserPhone(secondUser)),
        );
        if (firstHasPhone !== secondHasPhone) {
          return Number(secondHasPhone) - Number(firstHasPhone);
        }

        return getUserRegistrationTime(secondUser)
          - getUserRegistrationTime(firstUser);
      });
  }, [
    blockedPhoneNumbers,
    currentTime,
    customerFilter,
    customerUsers,
    searchTerm,
  ]);

  const customerPageCount = Math.max(
    1,
    Math.ceil(filteredUsers.length / CUSTOMER_PAGE_SIZE),
  );
  const currentCustomerPage = Math.min(customerPage, customerPageCount);
  const visibleUsers = filteredUsers.slice(
    (currentCustomerPage - 1) * CUSTOMER_PAGE_SIZE,
    currentCustomerPage * CUSTOMER_PAGE_SIZE,
  );
  const customerVisibleStart = filteredUsers.length
    ? (currentCustomerPage - 1) * CUSTOMER_PAGE_SIZE + 1
    : 0;
  const customerVisibleEnd = Math.min(
    currentCustomerPage * CUSTOMER_PAGE_SIZE,
    filteredUsers.length,
  );

  const handleCustomerSearchChange = (event) => {
    setSearchTerm(event.target.value);
    setCustomerPage(1);
  };

  const handleCustomerFilterChange = (filter) => {
    setCustomerFilter(filter);
    setCustomerPage(1);
  };

  const resetCustomerFilters = () => {
    setSearchTerm("");
    setCustomerFilter("all");
    setCustomerPage(1);
  };

  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );

  const filteredBlockedPhones = useMemo(() => {
    const normalizedQuery = blockedPhoneSearch.trim().toLowerCase();
    const compactPhoneQuery = normalizedQuery.replace(/\D/g, "");
    const phoneQuery = compactPhoneQuery.startsWith("63")
      ? `0${compactPhoneQuery.slice(2)}`
      : compactPhoneQuery;

    return blockedPhones.filter((blockedPhone) => {
      const storedPhone =
        blockedPhone.phoneNumber
        || blockedPhone.phone
        || blockedPhone.id;
      const normalizedPhone = normalizePHPhone(storedPhone);
      if (!normalizedQuery) return true;

      const matchedCustomer = customersByPhone.get(normalizedPhone)
        || usersById.get(blockedPhone.customerUid);
      const blockingAdmin = usersById.get(blockedPhone.blockedBy);
      const searchableText = [
        normalizedPhone,
        blockedPhone.customerName,
        getCustomerName(matchedCustomer),
        blockedPhone.address,
        getCustomerAddress(matchedCustomer),
        blockedPhone.reason,
        blockingAdmin?.email,
      ]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery)
        || Boolean(phoneQuery && normalizedPhone.includes(phoneQuery));
    });
  }, [blockedPhoneSearch, blockedPhones, customersByPhone, usersById]);
  const blockedPhonePageCount = Math.max(
    1,
    Math.ceil(filteredBlockedPhones.length / BLOCKED_PHONE_PAGE_SIZE),
  );
  const currentBlockedPhonePage = Math.min(
    blockedPhonePage,
    blockedPhonePageCount,
  );
  const visibleBlockedPhones = filteredBlockedPhones.slice(
    (currentBlockedPhonePage - 1) * BLOCKED_PHONE_PAGE_SIZE,
    currentBlockedPhonePage * BLOCKED_PHONE_PAGE_SIZE,
  );
  const blockedPhoneVisibleStart = filteredBlockedPhones.length
    ? (currentBlockedPhonePage - 1) * BLOCKED_PHONE_PAGE_SIZE + 1
    : 0;
  const blockedPhoneVisibleEnd = Math.min(
    currentBlockedPhonePage * BLOCKED_PHONE_PAGE_SIZE,
    filteredBlockedPhones.length,
  );

  const handleBlockedPhoneSearchChange = (event) => {
    setBlockedPhoneSearch(event.target.value);
    setBlockedPhonePage(1);
  };

  const clearBlockedPhoneSearch = () => {
    setBlockedPhoneSearch("");
    setBlockedPhonePage(1);
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setNotice("");
      const [usersLoaded, blockedPhonesLoaded, requestsLoaded] =
        await Promise.all([
          loadUsers(),
          loadBlockedPhones(),
          loadPhoneRestorationRequests(),
        ]);
      if (usersLoaded && blockedPhonesLoaded && requestsLoaded) {
        setNotice("Customer, phone, and restoration request lists refreshed.");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleUnblockPhone = async (phone) => {
    if (!window.confirm(`Unblock ${phone} and allow it to be used again?`)) {
      return;
    }

    try {
      setUnblockingPhone(phone);
      setBlockedPhonesError("");
      const pendingRequest = restorationRequests.find(
        (restorationRequest) =>
          restorationRequest.phoneNumber === phone
          && restorationRequest.status === "pending",
      );
      if (pendingRequest) {
        await resolvePhoneRestorationRequest(
          db,
          pendingRequest.id,
          "approved",
          auth.currentUser?.uid,
        );
        await loadPhoneRestorationRequests();
        setNotice(`${phone} restoration request approved and phone unblocked.`);
      } else {
        await unblockPhone(db, phone);
        setNotice(`${phone} has been unblocked.`);
      }
      setBlockedPhones((currentPhones) =>
        currentPhones.filter((blockedPhone) => blockedPhone.id !== phone),
      );
    } catch (unblockError) {
      console.error("Error unblocking phone number:", unblockError);
      setBlockedPhonesError(
        `Unable to unblock ${phone}. Please try again.`,
      );
    } finally {
      setUnblockingPhone("");
    }
  };

  const handleResolveRestorationRequest = async (
    restorationRequest,
    decision,
  ) => {
    const actionLabel = decision === "approved" ? "approve and unblock" : "reject";
    if (!window.confirm(
      `${actionLabel} the restoration request for ${restorationRequest.phoneNumber}?`,
    )) {
      return;
    }

    try {
      setResolvingRestorationId(restorationRequest.id);
      setRestorationRequestsError("");
      await resolvePhoneRestorationRequest(
        db,
        restorationRequest.id,
        decision,
        auth.currentUser?.uid,
      );
      await Promise.all([
        loadBlockedPhones(),
        loadPhoneRestorationRequests(),
      ]);
      setNotice(
        decision === "approved"
          ? `${restorationRequest.phoneNumber} was restored and unblocked.`
          : `Restoration request for ${restorationRequest.phoneNumber} was rejected.`,
      );
    } catch (resolveError) {
      console.error("Error resolving phone restoration request:", resolveError);
      setRestorationRequestsError(
        resolveError?.message
        || "Unable to resolve this restoration request. Please try again.",
      );
    } finally {
      setResolvingRestorationId("");
    }
  };

  const handleManualBlock = async (event) => {
    event.preventDefault();
    setManualBlockError("");

    const normalizedPhone = normalizePHPhone(manualPhone);
    const reason = manualReason.trim();
    if (!normalizedPhone) {
      setManualBlockError(
        "Enter a valid 11-digit Philippine mobile number (09XXXXXXXXX).",
      );
      return;
    }
    if (!reason) {
      setManualBlockError("Enter a reason for blocking this number.");
      return;
    }
    if (reason.length > 500) {
      setManualBlockError("The reason must be 500 characters or fewer.");
      return;
    }
    if (blockedPhoneNumbers.has(normalizedPhone)) {
      setManualBlockError("This number is already blocked.");
      return;
    }

    const matchedCustomer = customerUsers.find(
      (customer) => normalizePHPhone(getUserPhone(customer)) === normalizedPhone,
    );

    try {
      setBlockingPhone(true);
      await blockPhone(
        db,
        normalizedPhone,
        auth.currentUser?.uid,
        reason,
        matchedCustomer?.id,
      );
      setManualPhone("");
      setManualReason("");
      await loadBlockedPhones();
      setNotice(`${normalizedPhone} has been blocked.`);
    } catch (blockError) {
      console.error("Error manually blocking phone number:", blockError);
      setManualBlockError(
        blockError?.message || "Unable to block this number. Please try again.",
      );
    } finally {
      setBlockingPhone(false);
    }
  };

  const handleCopyPhone = async (phone) => {
    const normalizedPhone = normalizePHPhone(phone);
    if (!normalizedPhone) return;

    try {
      if (
        typeof navigator !== "undefined"
        && typeof navigator.clipboard?.writeText === "function"
      ) {
        try {
          await navigator.clipboard.writeText(normalizedPhone);
        } catch {
          fallbackCopyText(normalizedPhone);
        }
      } else {
        fallbackCopyText(normalizedPhone);
      }

      setCopyFeedback({ phone: normalizedPhone, copied: true });
    } catch (copyError) {
      console.error("Unable to copy customer phone number:", copyError);
      setCopyFeedback({ phone: normalizedPhone, copied: false });
    }

    window.clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = window.setTimeout(
      () => setCopyFeedback(null),
      1600,
    );
  };

  const handlePrefillBlock = (normalizedPhone) => {
    setManualPhone(normalizedPhone);
    setManualReason("");
    setManualBlockError("");
    document.getElementById("manual-block-form")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.requestAnimationFrame(() => {
      manualReasonInputRef.current?.focus({ preventScroll: true });
    });
  };

  const handleCustomerPhoneBlocked = async (phone) => {
    await loadBlockedPhones();
    setNotice(`${phone} has been blocked.`);
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (logoutError) {
      console.error("Error signing out administrator:", logoutError);
      setError("Unable to sign out. Please try again.");
      setLoggingOut(false);
    }
  };

  const handleResetPhoneCooldown = async (user) => {
    const phone = user.phoneNumber || user.phone;
    if (!phone) return;

    if (!window.confirm(
      `Reset the 30-day phone edit cooldown for ${getUserName(user)} (${phone})? They will be able to change their number immediately.`,
    )) {
      return;
    }

    try {
      setResettingCooldownUid(user.id);
      setError("");
      const resetTimestamp = createPhoneCooldownResetTimestamp();
      await updateDoc(doc(db, "users", user.id), {
        phoneUpdatedAt: resetTimestamp,
      });
      setUsers((currentUsers) =>
        currentUsers.map((currentUser) => {
          if (currentUser.id !== user.id) return currentUser;
          return {
            ...currentUser,
            phoneUpdatedAt: resetTimestamp,
          };
        }),
      );
      setNotice(`Phone edit cooldown reset for ${getUserName(user)}.`);
    } catch (resetError) {
      console.error("Error resetting customer phone cooldown:", resetError);
      setError(
        "Unable to reset the phone edit cooldown. Please try again.",
      );
    } finally {
      setResettingCooldownUid("");
    }
  };
  if (loading) {
    return (
      <main className="admin-users-page">
        <section className="admin-users-loading">
          <div className="loading-icon">◎</div>

          <p className="admin-users-eyebrow">
            CACTUS CAFE
          </p>

          <h1>Loading user workspace</h1>

          <div className="loading-bar" />
        </section>
      </main>
    );
  }

  return (
    <main className="admin-users-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="admin-users-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`admin-users-sidebar${
          mobileNavigationOpen ? " is-open" : ""
        }`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/menu"
          className="admin-users-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-users-brand-mark" aria-hidden="true">🌵</span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-users-sidebar-label">WORKSPACE</div>
        <nav className="admin-users-nav">
          {[
            ["▦", "Menu Management", "/admin/menu"],
            ["↗", "Orders", "/admin/orders"],
            ["₱", "Payment Management", "/admin/payments"],
            ["◷", "Reservations", "/admin/reservations"],
            ["☆", "Reviews", "/admin/reviews"],
            ["◎", "Customers & Security", "/admin/users"],
            ["▤", "Monthly Records", "/admin/monthly-records"],
          ].map(([icon, label, to]) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `admin-users-nav-link${isActive ? " active" : ""}`
              }
              onClick={() => setMobileNavigationOpen(false)}
            >
              <span className="admin-users-nav-icon" aria-hidden="true">
                {icon}
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-users-sidebar-footer">
          <div className="admin-users-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Protect customer accounts while keeping their details current.</p>
          </div>
          <button
            type="button"
            className="admin-users-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="admin-users-nav-icon" aria-hidden="true">↪</span>
            <span>{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>

      <div className="admin-users-main">
      <div className="admin-users-container">
        <header className="admin-users-header">
          <button
            type="button"
            className="admin-users-mobile-toggle"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <div>
            <p className="admin-users-eyebrow">CUSTOMER DIRECTORY</p>
            <h1>Customers &amp; Security</h1>
            <p>
              Manage registered customer accounts, phone edit cooldowns, and
              blocked numbers.
            </p>
          </div>

          <div className="admin-users-header-actions">
            <button
              type="button"
              className="refresh-users-button"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "↻ Refresh"}
            </button>
          </div>
        </header>

        <section className="users-metrics-grid" aria-label="Customer security summary">
          <article className="users-metric-card">
            <span className="users-metric-icon">◎</span>
            <span>Total Customers</span>
            <strong>{statistics.customers}</strong>
          </article>
          <article className="users-metric-card metric-cooldown">
            <span className="users-metric-icon">◷</span>
            <span>Active Phone Cooldowns</span>
            <strong>{statistics.activeCooldowns}</strong>
          </article>
          <article className="users-metric-card metric-blocked">
            <span className="users-metric-icon">⛨</span>
            <span>Blocked Numbers</span>
            <strong>{statistics.blockedNumbers}</strong>
          </article>
        </section>

        <section className="blocked-phone-section">
          <div className="blocked-phone-heading">
            <div>
              <p className="admin-users-eyebrow">SAFETY CONTROLS</p>
              <h2>Phone number security</h2>
              <p>
                Review active blocks and manage phone numbers that cannot place
                orders or reservations.
              </p>
            </div>
          </div>

          <div className="phone-security-grid">
            <form
              id="manual-block-form"
              className="manual-block-card"
              onSubmit={handleManualBlock}
            >
              <p className="admin-users-eyebrow">MANUAL BLOCK</p>
              <h3>Block a phone number</h3>
              <p>
                Use the normalized 09XXXXXXXXX number. Blocked numbers cannot
                place new orders or reservations.
              </p>
              <label className="admin-users-form-field">
                <span>Mobile number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  maxLength={24}
                  placeholder="09XXXXXXXXX"
                  value={manualPhone}
                  onChange={(event) => {
                    setManualPhone(event.target.value);
                    setManualBlockError("");
                  }}
                  required
                />
              </label>
              <label className="admin-users-form-field">
                <span>Reason</span>
                <textarea
                  ref={manualReasonInputRef}
                  maxLength={500}
                  placeholder="e.g., Fake order / no-show"
                  value={manualReason}
                  onChange={(event) => {
                    setManualReason(event.target.value);
                    setManualBlockError("");
                  }}
                  rows={3}
                  required
                />
              </label>
              {manualBlockError && (
                <p className="manual-block-error" role="alert">
                  {manualBlockError}
                </p>
              )}
              <button
                type="submit"
                className="manual-block-submit"
                disabled={blockingPhone || blockedPhonesLoading}
              >
                {blockingPhone ? "Blocking..." : "Block number"}
              </button>
            </form>

            <section className="blocked-phone-list-panel">
              <div className="blocked-phone-list-heading">
                <div>
                  <p className="admin-users-eyebrow">ACTIVE BLOCKS</p>
                  <h3>Blocked phone numbers</h3>
                </div>
                <span className="blocked-phone-count">
                  {blockedPhones.length}
                </span>
              </div>

              {!blockedPhonesLoading
                && !blockedPhonesError
                && blockedPhones.length > 0 && (
                <>
                  <div className="blocked-phone-search">
                    <label htmlFor="blocked-phone-search">
                      Search active blocks
                    </label>
                    <div className="blocked-phone-search-control">
                      <input
                        id="blocked-phone-search"
                        type="search"
                        value={blockedPhoneSearch}
                        onChange={handleBlockedPhoneSearchChange}
                        placeholder="Phone, customer, address, reason, or admin"
                        aria-label="Search blocked phone numbers"
                      />
                      {blockedPhoneSearch && (
                        <button
                          type="button"
                          className="blocked-phone-search-clear"
                          onClick={clearBlockedPhoneSearch}
                          aria-label="Clear blocked phone search"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="blocked-phone-list-controls">
                    <p className="blocked-phone-results-count" aria-live="polite">
                      {filteredBlockedPhones.length > 0
                        ? `Showing ${blockedPhoneVisibleStart}-${blockedPhoneVisibleEnd} of ${filteredBlockedPhones.length} ${blockedPhoneSearch.trim() ? "matching" : "active"} numbers`
                        : "0 matching numbers"}
                    </p>
                    {blockedPhonePageCount > 1 && (
                      <div
                        className="blocked-phone-pagination"
                        aria-label="Blocked phone pages"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setBlockedPhonePage(currentBlockedPhonePage - 1)
                          }
                          disabled={currentBlockedPhonePage === 1}
                        >
                          Previous
                        </button>
                        <span>
                          Page {currentBlockedPhonePage} of {blockedPhonePageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setBlockedPhonePage(currentBlockedPhonePage + 1)
                          }
                          disabled={
                            currentBlockedPhonePage === blockedPhonePageCount
                          }
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {blockedPhonesError && (
                <div className="admin-users-error" role="alert">
                  <span>!</span>
                  <p>{blockedPhonesError}</p>
                  <button type="button" onClick={loadBlockedPhones}>
                    Try again
                  </button>
                </div>
              )}

              {blockedPhonesLoading ? (
                <p className="blocked-phone-empty" role="status">
                  Loading blocked numbers...
                </p>
              ) : blockedPhonesError ? null : blockedPhones.length === 0 ? (
                <p className="blocked-phone-empty">
                  There are no active blocked phone numbers.
                </p>
              ) : filteredBlockedPhones.length === 0 ? (
                <div className="blocked-phone-empty blocked-phone-empty-search">
                  <p>No blocked phone numbers match this search.</p>
                  <button
                    type="button"
                    className="blocked-phone-search-clear"
                    onClick={clearBlockedPhoneSearch}
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="blocked-phone-list">
                  {visibleBlockedPhones.map((blockedPhone) => {
                    const storedPhone =
                      blockedPhone.phoneNumber
                      || blockedPhone.phone
                      || blockedPhone.id;
                    const normalizedPhone = normalizePHPhone(storedPhone);
                    const phone = normalizedPhone || storedPhone;
                    const matchedCustomer = customersByPhone.get(normalizedPhone)
                      || usersById.get(blockedPhone.customerUid);
                    const blockingAdmin = usersById.get(blockedPhone.blockedBy);
                    const customerName = typeof blockedPhone.customerName === "string"
                      ? blockedPhone.customerName.trim()
                      : "";
                    const address = typeof blockedPhone.address === "string"
                      ? blockedPhone.address.trim()
                      : "";

                    return (
                      <article
                        className="blocked-phone-row"
                        key={blockedPhone.id}
                      >
                        <div className="blocked-phone-card-header">
                          <div className="blocked-phone-number">
                            <strong>{phone}</strong>
                            <span className="admin-phone-blocked-badge">
                              BLOCKED
                            </span>
                          </div>
                          <button
                            type="button"
                            className="unblock-phone-button"
                            onClick={() => handleUnblockPhone(phone)}
                            disabled={unblockingPhone === phone}
                          >
                            {unblockingPhone === phone ? "Unblocking..." : "Unblock"}
                          </button>
                        </div>
                        <div className="blocked-phone-details">
                          <div>
                            <span className="user-label">CUSTOMER</span>
                            <strong>
                              {customerName
                                || getCustomerName(matchedCustomer)
                                || "Customer details unavailable"}
                            </strong>
                          </div>
                          <div className="blocked-phone-address">
                            <span className="user-label">ADDRESS</span>
                            <strong>
                              {address
                                || getCustomerAddress(matchedCustomer)
                                || "No address available"}
                            </strong>
                          </div>
                          <div>
                            <span className="user-label">REASON</span>
                            <strong>{blockedPhone.reason || "No reason recorded"}</strong>
                          </div>
                          <div>
                            <span className="user-label">BLOCKED DATE</span>
                            <strong>{formatDate(blockedPhone.blockedAt)}</strong>
                          </div>
                          <div>
                            <span className="user-label">ADMIN</span>
                            <strong>
                              {blockingAdmin
                                ? blockingAdmin.email || getUserName(blockingAdmin)
                                : blockedPhone.blockedBy || "Unknown admin"}
                            </strong>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>

        <section className="restoration-request-section">
          <div className="restoration-request-heading">
            <div>
              <p className="admin-users-eyebrow">CUSTOMER APPEALS</p>
              <h2>Restoration Requests</h2>
              <p>
                Review requests to restore blocked phone numbers. Approval
                unblocks the number immediately.
              </p>
            </div>
            <span className="blocked-phone-count">
              {restorationRequests.filter(
                (restorationRequest) =>
                  restorationRequest.status === "pending",
              ).length} pending
            </span>
          </div>

          {restorationRequestsError && (
            <div className="admin-users-error" role="alert">
              <span>!</span>
              <p>{restorationRequestsError}</p>
              <button type="button" onClick={loadPhoneRestorationRequests}>
                Try again
              </button>
            </div>
          )}

          {restorationRequestsLoading ? (
            <p className="blocked-phone-empty" role="status">
              Loading restoration requests...
            </p>
          ) : restorationRequestsError ? null : restorationRequests.length === 0 ? (
            <p className="blocked-phone-empty">
              There are no recent phone restoration requests.
            </p>
          ) : (
            <div className="restoration-request-list">
              {restorationRequests.map((restorationRequest) => {
                const customer = usersById.get(restorationRequest.uid);
                const blockedRecord = blockedPhones.find(
                  (blockedPhone) =>
                    blockedPhone.id === restorationRequest.phoneNumber,
                );
                const isPending = restorationRequest.status === "pending";

                return (
                  <article
                    className="restoration-request-card"
                    key={restorationRequest.id}
                  >
                    <div className="restoration-request-card-heading">
                      <div>
                        <strong>
                          {customer
                            ? getUserName(customer)
                            : "Customer profile unavailable"}
                        </strong>
                        <span>
                          {customer?.email || restorationRequest.uid}
                        </span>
                      </div>
                      <span
                        className={`restoration-request-badge request-status-${restorationRequest.status}`}
                      >
                        {restorationRequest.status}
                      </span>
                    </div>
                    <div className="restoration-request-information">
                      <div>
                        <span className="user-label">PHONE NUMBER</span>
                        <strong>{restorationRequest.phoneNumber}</strong>
                      </div>
                      <div>
                        <span className="user-label">SUBMITTED</span>
                        <strong>{formatDate(restorationRequest.createdAt)}</strong>
                      </div>
                      <div>
                        <span className="user-label">ORIGINAL BLOCK REASON</span>
                        <p>
                          {blockedRecord?.reason
                            || "The block record is no longer available."}
                        </p>
                      </div>
                      <div>
                        <span className="user-label">CUSTOMER APPEAL</span>
                        <p>{restorationRequest.reason}</p>
                      </div>
                    </div>
                    {isPending && (
                      <div className="restoration-request-actions">
                        <button
                          type="button"
                          className="approve-restoration-button"
                          onClick={() =>
                            handleResolveRestorationRequest(
                              restorationRequest,
                              "approved",
                            )
                          }
                          disabled={
                            resolvingRestorationId === restorationRequest.id
                          }
                        >
                          {resolvingRestorationId === restorationRequest.id
                            ? "Resolving..."
                            : "Approve & Unblock"}
                        </button>
                        <button
                          type="button"
                          className="reject-restoration-button"
                          onClick={() =>
                            handleResolveRestorationRequest(
                              restorationRequest,
                              "rejected",
                            )
                          }
                          disabled={
                            resolvingRestorationId === restorationRequest.id
                          }
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {notice && (
          <div className="admin-users-notice" role="status">
            <span>✓</span>
            {notice}
          </div>
        )}

        {error && (
          <div className="admin-users-error" role="alert">
            <span>!</span>
            <p>{error}</p>

            <button
              type="button"
              onClick={loadUsers}
            >
              Try again
            </button>
          </div>
        )}

        <section className="users-toolbar">
          <div>
            <p className="admin-users-eyebrow">
              REGISTERED CUSTOMERS
            </p>

            <h2>Customer accounts</h2>
          </div>

          <div className="users-toolbar-actions">
            <label className="users-search">
              <span>⌕</span>

              <input
                type="search"
                placeholder="Search name, email, phone, or user ID"
                aria-label="Search customers by name, email, phone, or user ID"
                value={searchTerm}
                onChange={handleCustomerSearchChange}
              />
            </label>
            {searchTerm && (
              <button
                type="button"
                className="customer-search-clear"
                onClick={() => {
                  setSearchTerm("");
                  setCustomerPage(1);
                }}
              >
                Clear search
              </button>
            )}
          </div>
        </section>

        <div className="customer-filter-pills" role="group" aria-label="Customer filters">
          {[
            ["all", "All"],
            ["cooldown", "Cooldown Active"],
            ["blocked", "Blocked"],
          ].map(([filter, label]) => (
            <button
              type="button"
              key={filter}
              className={`customer-filter-pill${
                customerFilter === filter ? " active" : ""
              }`}
              aria-pressed={customerFilter === filter}
              onClick={() => handleCustomerFilterChange(filter)}
            >
              {label}
              {filter === "all" && (
                <span>{customerUsers.length}</span>
              )}
              {filter === "cooldown" && (
                <span>{statistics.activeCooldowns}</span>
              )}
              {filter === "blocked" && (
                <span>
                  {customerUsers.filter((customer) =>
                    blockedPhoneNumbers.has(
                      normalizePHPhone(getUserPhone(customer)),
                    ),
                  ).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {!error && customerUsers.length > 0 && (
          <div className="customer-directory-controls">
            <p className="customer-results-count" aria-live="polite">
              {filteredUsers.length > 0
                ? `Showing ${customerVisibleStart}-${customerVisibleEnd} of ${filteredUsers.length} matching ${filteredUsers.length === 1 ? "customer" : "customers"}`
                : "0 customers match the current search and filters"}
            </p>
            {customerPageCount > 1 && (
              <div
                className="customer-pagination"
                aria-label="Customer directory pages"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCustomerPage(currentCustomerPage - 1)
                  }
                  disabled={currentCustomerPage === 1}
                >
                  Previous
                </button>
                <span>
                  Page {currentCustomerPage} of {customerPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCustomerPage(currentCustomerPage + 1)
                  }
                  disabled={currentCustomerPage === customerPageCount}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {!error && customerUsers.length === 0 && (
          <section className="admin-users-empty">
            <div className="empty-icon">◎</div>

            <p className="admin-users-eyebrow">
              REGISTERED CUSTOMERS
            </p>

            <h2>No customers yet</h2>

            <p>
              Registered customer accounts will appear here.
            </p>
          </section>
        )}

        {!error &&
          customerUsers.length > 0 &&
          filteredUsers.length === 0 && (
            <section className="admin-users-empty compact-empty">
              <div className="empty-icon">⌕</div>

              <h2>No matching users</h2>

              <p>Try another search term or choose a different filter.</p>
              <button
                type="button"
                className="customer-reset-filters"
                onClick={resetCustomerFilters}
              >
                Reset search and filters
              </button>
            </section>
          )}

        {!error && filteredUsers.length > 0 && (
          <section className="admin-users-list">
            <div className="users-list-heading">
              <div>
                <p className="admin-users-eyebrow">
                  USER ACTIVITY
                </p>

                <h2>
                  {filteredUsers.length}{" "}
                  {filteredUsers.length === 1
                    ? "customer found"
                    : "customers found"}
                </h2>
              </div>
            </div>

            <div className="users-grid">
              {visibleUsers.map((user) => {
                const name = getUserName(user);
                const email = user.email || "No email";
                const phone = getUserPhone(user);
                const normalizedPhone = normalizePHPhone(phone);
                const phoneBlocked = blockedPhoneNumbers.has(normalizedPhone);
                const cooldownEnd = getPhoneCooldownEnd(user);
                const cooldownActive = isPhoneCooldownActive(user, currentTime);

                return (
                  <article
                    className="admin-user-card"
                    key={user.id}
                  >
                    <div className="user-card-header">
                      <div className="user-profile">
                        <div className="user-avatar">
                          {getInitials(user)}
                        </div>

                        <div>
                          <span className="user-label">
                            ACCOUNT
                          </span>

                          <h3>{name}</h3>

                          <p>{email}</p>
                        </div>
                      </div>

                      <span className="user-role user-role-customer">
                        Customer
                      </span>
                    </div>

                    <div className="user-details">
                      <div>
                        <span className="user-label">
                          EMAIL
                        </span>

                        <strong>{email}</strong>
                      </div>

                      <div>
                        <span className="user-label">
                          PHONE NUMBER
                        </span>

                        <div className="customer-phone-row">
                          <strong>{phone || "No phone number"}</strong>
                          {normalizedPhone && (
                            <div className="customer-phone-quick-actions">
                              <button
                                type="button"
                                className="customer-phone-quick-button"
                                onClick={() => handleCopyPhone(phone)}
                                aria-label={`Copy ${normalizedPhone}`}
                              >
                                {copyFeedback?.phone === normalizedPhone
                                  ? copyFeedback.copied
                                    ? "Copied"
                                    : "Copy failed"
                                  : "Copy"}
                              </button>
                              {!phoneBlocked && (
                                <button
                                  type="button"
                                  className="customer-phone-quick-button prefill-block-button"
                                  onClick={() => handlePrefillBlock(normalizedPhone)}
                                  aria-label={`Prefill block form for ${normalizedPhone}`}
                                >
                                  Prefill Block
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <PhoneBlockControl
                          phone={phone}
                          customerUid={user.id}
                          adminUid={auth.currentUser?.uid}
                          isBlocked={phoneBlocked}
                          allowUnblock
                          unblocking={unblockingPhone === normalizedPhone}
                          onBlocked={handleCustomerPhoneBlocked}
                          onUnblocked={handleUnblockPhone}
                        />
                      </div>

                      <div>
                        <span className="user-label">
                          REGISTERED
                        </span>

                        <strong>
                          {formatDate(user.createdAt)}
                        </strong>
                      </div>
                    </div>

                    <div className="user-cooldown-actions">
                          <span className={
                            cooldownActive
                              ? "phone-cooldown-status is-locked"
                              : "phone-cooldown-status is-editable"
                          }>
                            {!phone
                              ? "No phone number on file; editable during setup"
                              : cooldownActive && cooldownEnd
                                ? `Locked until ${formatDate(new Date(cooldownEnd))}`
                                : cooldownActive
                                  ? "Locked; cooldown start date unavailable"
                                  : "Editable now"}
                          </span>
                          {phone && (
                          <button
                            type="button"
                            className="reset-phone-cooldown-button"
                            onClick={() => handleResetPhoneCooldown(user)}
                            disabled={resettingCooldownUid === user.id}
                          >
                            {resettingCooldownUid === user.id
                              ? "Resetting..."
                              : "Reset phone cooldown"}
                          </button>
                          )}
                    </div>

                    <div className="user-card-footer">
                      <span className="user-label">
                        USER ID
                      </span>

                      <code title={user.id}>
                        {user.id}
                      </code>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
      </div>
    </main>
  );
}

export default AdminUsers;