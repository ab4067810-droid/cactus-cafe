import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { NavLink, useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import {
  createMenuWriteService,
  MenuWriteConflictError,
} from "../services/menuWriteService";
import "../styles/AdminMenu.css";
import "../styles/AdminSidebar.css";

const menuWriteService = createMenuWriteService(db);
const drinkSizes = ["8oz", "12oz", "16oz"];
const isSizeVariantCategory = (value) => (
  ["soda", "milktea"].includes(
    String(value || "").trim().toLowerCase().replace(/\s+/g, ""),
  )
);

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

function AdminMenu() {
  const navigate = useNavigate();

  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [updatingItemIds, setUpdatingItemIds] = useState(() => new Set());
  const [feedback, setFeedback] = useState(null);
  const [migrationState, setMigrationState] = useState(null);
  const [migrationStatusError, setMigrationStatusError] = useState(false);
  const [migrationOperatorEnabled, setMigrationOperatorEnabled] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [sizePrices, setSizePrices] = useState({
    "8oz": "",
    "12oz": "",
    "16oz": "",
  });
  const [imageUrl, setImageUrl] = useState("");
  const [featured, setFeatured] = useState(false);
  const [popular, setPopular] = useState(false);
  const [available, setAvailable] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedAvailability, setSelectedAvailability] = useState("all");
  const menuWritesLocked = migrationStatusError
    || (
      migrationState !== "ready"
      && !(migrationState === "migrating" && migrationOperatorEnabled)
    );

  const loadMenuItems = useCallback(async () => {
    try {
      setLoadError("");

      const snapshot = await getDocs(
        collection(db, "menuItems")
      );

      const items = snapshot.docs.map((menuDoc) => ({
        id: menuDoc.id,
        ...menuDoc.data(),
      }));

      setMenuItems(items);
    } catch (error) {
      console.error("Error loading menu:", error);
      setLoadError(
        "Unable to load menu items. Please try again."
      );
    }
  }, []);

  useEffect(() => {
    let unsubscribeMigration = null;
    let unsubscribeMigrationOperator = null;
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          unsubscribeMigration?.();
          unsubscribeMigration = null;
          unsubscribeMigrationOperator?.();
          unsubscribeMigrationOperator = null;
          setMigrationState(null);
          setMigrationOperatorEnabled(false);
          navigate("/login");
          return;
        }

        unsubscribeMigration?.();
        unsubscribeMigrationOperator?.();
        setMigrationState(null);
        setMigrationStatusError(false);
        setMigrationOperatorEnabled(false);
        unsubscribeMigration = onSnapshot(
          doc(db, "menuControl/migration"),
          (snapshot) => {
            setMigrationState(
              snapshot.exists() ? snapshot.data().state : null,
            );
            setMigrationStatusError(false);
          },
          (error) => {
            console.error("Error loading menu migration state:", error);
            setMigrationState(null);
            setMigrationStatusError(true);
          },
        );
        unsubscribeMigrationOperator = onSnapshot(
          doc(db, "migrationOperators", currentUser.uid),
          (snapshot) => {
            setMigrationOperatorEnabled(
              snapshot.exists() && snapshot.data().enabled === true,
            );
          },
          (error) => {
            console.error("Error loading migration operator grant:", error);
            setMigrationOperatorEnabled(false);
          },
        );

        try {
          await loadMenuItems();
        } finally {
          setLoading(false);
        }
      }
    );

    return () => {
      unsubscribe();
      unsubscribeMigration?.();
      unsubscribeMigrationOperator?.();
    };
  }, [loadMenuItems, navigate]);

  const categories = useMemo(() => {
    const uniqueCategories = [
      ...new Set(
        menuItems
          .map((item) => item.category?.trim())
          .filter(Boolean)
      ),
    ];

    return ["All", ...uniqueCategories];
  }, [menuItems]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return menuItems.filter((item) => {
      const itemCategory = item.category?.toLowerCase() || "";

      const matchesCategory =
        selectedCategory === "All" ||
        itemCategory === selectedCategory.toLowerCase();

      const searchableText = `
        ${item.name || ""}
        ${item.category || ""}
        ${item.description || ""}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      const isAvailable = item.available !== false;
      const matchesAvailability =
        selectedAvailability === "all" ||
        (selectedAvailability === "available" && isAvailable) ||
        (selectedAvailability === "unavailable" && !isAvailable);

      return matchesCategory && matchesSearch && matchesAvailability;
    });
  }, [menuItems, searchTerm, selectedCategory, selectedAvailability]);

  const availableCount = menuItems.filter(
    (item) => item.available !== false,
  ).length;
  const unavailableCount = menuItems.length - availableCount;
  const featuredCount = menuItems.filter(
    (item) => item.featured === true,
  ).length;

  const getWriteErrorMessage = (error, action) => {
    if (error instanceof MenuWriteConflictError) {
      return `${error.message} The menu will be refreshed.`;
    }
    if (error?.code === "permission-denied") {
      const firestoreDetail = error.message
        ? ` Firestore detail: ${error.message}`
        : "";
      return `Firestore rejected the paired menu and price-book update while trying to ${action}. Confirm that your account has the admin role, the menu migration state allows writes, and the price-book entry is synchronized.${firestoreDetail}`;
    }
    return `Unable to ${action}. ${error?.message || "Please try again."}`;
  };

  const migrationLockMessage = migrationStatusError
    ? "Menu editing is paused because the migration status could not be verified. Reload the page or contact the project owner."
    : migrationState === "migrating"
      ? "Menu editing is paused while the menu migration is in progress."
      : migrationState === "finalizing"
        ? "Menu editing is locked while the migration is being finalized."
        : "Menu editing is paused because the migration status is unavailable or not ready.";

  const resetForm = () => {
    setName("");
    setCategory("");
    setDescription("");
    setPrice("");
    setSizePrices({ "8oz": "", "12oz": "", "16oz": "" });
    setImageUrl("");
    setFeatured(false);
    setPopular(false);
    setAvailable(true);
    setEditingId(null);
    setShowForm(false);
    setFeedback(null);
  };

  const openAddForm = () => {
    if (menuWritesLocked) return;

    setEditingId(null);
    setName("");
    setCategory("");
    setDescription("");
    setPrice("");
    setSizePrices({ "8oz": "", "12oz": "", "16oz": "" });
    setImageUrl("");
    setFeatured(false);
    setPopular(false);
    setAvailable(true);
    setShowForm(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleSubmitMenuItem = async (event) => {
    event.preventDefault();
    if (menuWritesLocked) return;

    if (
      !name.trim() ||
      !category.trim() ||
      !description.trim()
    ) {
      setFeedback({ type: "error", message: "Please complete all required fields." });
      return;
    }

    const hasSizeVariants = isSizeVariantCategory(category);
    let numericPrice;
    let numericSizes;

    if (hasSizeVariants) {
      const invalidSizePrice = drinkSizes.some((size) => {
        const sizePrice = Number(sizePrices[size]);
        return (
          sizePrices[size] === ""
          || !Number.isFinite(sizePrice)
          || sizePrice < 0
          || sizePrice > 1000000
        );
      });

      if (invalidSizePrice) {
        setFeedback({
          type: "error",
          message: "Enter a valid price for each drink size.",
        });
        return;
      }

      numericSizes = Object.fromEntries(
        drinkSizes.map((size) => [size, Number(sizePrices[size])]),
      );
      numericPrice = numericSizes["8oz"];
    } else {
      if (!price) {
        setFeedback({
          type: "error",
          message: "Please complete all required fields.",
        });
        return;
      }

      numericPrice = Number(price);
      if (
        !Number.isFinite(numericPrice)
        || numericPrice < 0
        || numericPrice > 1000000
      ) {
        setFeedback({ type: "error", message: "Please enter a valid price." });
        return;
      }
    }

    try {
      setSaving(true);
      setFeedback(null);

      const itemData = {
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        price: numericPrice,
        ...(hasSizeVariants ? { sizes: numericSizes } : {}),
        imageUrl: imageUrl.trim(),
        featured,
        popular,
        available,
      };

      if (editingId) {
        const displayedItem = menuItems.find((item) => item.id === editingId);
        await menuWriteService.updateMenuItem(editingId, itemData, {
          expectedMenuRevision: displayedItem?.menuRevision,
        });
      } else {
        await menuWriteService.createMenuItem(itemData);
      }

      resetForm();
      setFeedback({
        type: "success",
        message: editingId
          ? "Menu item updated successfully."
          : "Menu item added successfully.",
      });
      await loadMenuItems();
    } catch (error) {
      console.error("Error saving menu item:", error);
      setFeedback({
        type: "error",
        message: getWriteErrorMessage(error, "save the menu item"),
      });
      if (error instanceof MenuWriteConflictError) await loadMenuItems();
    } finally {
      setSaving(false);
    }
  };

  const handleEditMenuItem = (item) => {
    if (menuWritesLocked) return;

    setEditingId(item.id);
    setName(item.name || "");
    setCategory(item.category || "");
    setDescription(item.description || "");
    setPrice(
      item.price !== undefined
        ? String(item.price)
        : ""
    );
    setSizePrices(Object.fromEntries(
      drinkSizes.map((size) => [
        size,
        item.sizes?.[size] !== undefined
          ? String(item.sizes[size])
          : size === "8oz" && item.price !== undefined
            ? String(item.price)
            : "",
      ]),
    ));
    setImageUrl(item.imageUrl || "");
    setFeatured(Boolean(item.featured));
    setPopular(Boolean(item.popular));
    setAvailable(item.available !== false);
    setShowForm(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleDeleteMenuItem = async (id, itemName) => {
    if (menuWritesLocked) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${itemName}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(id);
      setFeedback(null);
      const displayedItem = menuItems.find((item) => item.id === id);
      await menuWriteService.deleteMenuItem(id, {
        expectedMenuRevision: displayedItem?.menuRevision,
      });
      setFeedback({ type: "success", message: "Menu item deleted successfully." });
      await loadMenuItems();
    } catch (error) {
      console.error("Error deleting menu item:", error);
      setFeedback({
        type: "error",
        message: getWriteErrorMessage(error, "delete the menu item"),
      });
      if (error instanceof MenuWriteConflictError) await loadMenuItems();
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleMenuItem = async (item, field) => {
    if (
      menuWritesLocked
      || updatingItemIds.has(item.id)
      || deletingId === item.id
    ) return;

    setUpdatingItemIds((current) => new Set(current).add(item.id));
    setFeedback(null);
    try {
      const nextValue = !(field === "available"
        ? item.available !== false
        : item.featured === true);
      const options = { expectedMenuRevision: item.menuRevision };
      if (field === "available") {
        await menuWriteService.setMenuItemAvailability(item.id, nextValue, options);
      } else {
        await menuWriteService.setMenuItemFeatured(item.id, nextValue, options);
      }

      setFeedback({
        type: "success",
        message: `${item.name || "Menu item"} is now ${field === "available"
          ? nextValue ? "available" : "unavailable"
          : nextValue ? "featured" : "not featured"}.`,
      });
      await loadMenuItems();
    } catch (error) {
      console.error(`Error updating menu item ${field}:`, error);
      setFeedback({
        type: "error",
        message: getWriteErrorMessage(error, "update the menu item"),
      });
      await loadMenuItems();
    } finally {
      setUpdatingItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };
  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      alert("Unable to log out. Please try again.");
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <main className="admin-menu-page">
        <section className="admin-menu-loading">
          <div className="loading-icon">🌵</div>
          <p className="admin-menu-eyebrow">CACTUS CAFE</p>
          <h1>Loading menu workspace</h1>
          <div className="loading-bar" />
        </section>
      </main>
    );
  }

  return (
    <main className="admin-menu-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="admin-menu-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`admin-menu-sidebar ${
          mobileNavigationOpen ? "is-open" : ""
        }`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/menu"
          className="admin-menu-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-menu-brand-mark" aria-hidden="true">🌵</span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-menu-sidebar-label">WORKSPACE</div>
        <nav className="admin-menu-nav">
          <NavLink
            to="/admin/menu"
            end
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">▦</span>
            <span>Menu Management</span>
          </NavLink>
          <NavLink
            to="/admin/orders"
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">↗</span>
            <span>Orders</span>
          </NavLink>
          <NavLink
            to="/admin/payments"
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">₱</span>
            <span>Payment Management</span>
          </NavLink>
          <NavLink
            to="/admin/reservations"
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">◷</span>
            <span>Reservations</span>
          </NavLink>
          <NavLink
            to="/admin/reviews"
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">☆</span>
            <span>Reviews</span>
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">◎</span>
            <span>Customers &amp; Security</span>
          </NavLink>
          <NavLink
            to="/admin/monthly-records"
            className={({ isActive }) =>
              `admin-menu-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">▤</span>
            <span>Monthly Records</span>
          </NavLink>
        </nav>

        <div className="admin-menu-sidebar-footer">
          <div className="admin-menu-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Thoughtful menus make memorable visits.</p>
          </div>
          <button
            type="button"
            className="admin-menu-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="admin-menu-nav-icon" aria-hidden="true">↪</span>
            <span>{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>

      <div className="admin-menu-main">
        <div className="admin-menu-container">
        <header className="admin-menu-header">
          <button
            type="button"
            className="admin-menu-mobile-toggle"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="admin-menu-heading">
            <p className="admin-menu-eyebrow">CAFE CATALOG</p>
            <h1>Menu Management</h1>
            <p>Manage your products, categories, and availability.</p>
          </div>
          <div className="admin-menu-profile">
            <span className="admin-menu-profile-avatar" aria-hidden="true">
              {(auth.currentUser?.displayName || "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="admin-menu-profile-copy">
              <strong>{auth.currentUser?.displayName || "Cafe Admin"}</strong>
              <small>Administrator</small>
            </span>
          </div>
        </header>

        {menuWritesLocked && (
          <div
            className="admin-menu-migration-notice"
            role={migrationStatusError ? "alert" : "status"}
          >
            {migrationLockMessage}
          </div>
        )}

        <section className="menu-overview">
          <div className="menu-overview-stat">
            <span className="menu-stat-icon products-icon" aria-hidden="true">▦</span>
            <span className="menu-stat-copy">
              <span>Total Items</span>
              <strong>{menuItems.length}</strong>
            </span>
          </div>

          <div className="menu-overview-stat">
            <span className="menu-stat-icon available-icon" aria-hidden="true">✓</span>
            <span className="menu-stat-copy">
              <span>Available</span>
              <strong>{availableCount}</strong>
            </span>
          </div>

          <div className="menu-overview-stat">
            <span className="menu-stat-icon unavailable-icon" aria-hidden="true">−</span>
            <span className="menu-stat-copy">
              <span>Unavailable</span>
              <strong>{unavailableCount}</strong>
            </span>
          </div>

          <div className="menu-overview-stat">
            <span className="menu-stat-icon featured-icon" aria-hidden="true">✦</span>
            <span className="menu-stat-copy">
              <span>Featured</span>
              <strong>{featuredCount}</strong>
            </span>
          </div>

          <div className="menu-overview-stat">
            <span className="menu-stat-icon categories-icon" aria-hidden="true">◈</span>
            <span className="menu-stat-copy">
              <span>Categories</span>
              <strong>{categories.length - 1}</strong>
            </span>
          </div>

          <button
            type="button"
            className="add-menu-button"
            disabled={!showForm && menuWritesLocked}
            onClick={() => {
              showForm ? resetForm() : openAddForm();
            }}
          >
            {showForm ? "Cancel" : "+ Add product"}
          </button>
        </section>

        {feedback && (
          <div
            className={`admin-menu-feedback ${feedback.type}`}
            role={feedback.type === "error" ? "alert" : "status"}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        {showForm && (
          <section className="add-menu-form-section">
            <div className="form-section-heading">
              <div>
                <p className="admin-menu-eyebrow">
                  {editingId ? "EDIT PRODUCT" : "NEW PRODUCT"}
                </p>

                <h2>
                  {editingId
                    ? "Update menu item"
                    : "Add a menu item"}
                </h2>

                <p>
                  This information will appear on the customer
                  menu.
                </p>
              </div>

              <button
                type="button"
                className="close-form-button"
                onClick={resetForm}
                aria-label="Close form"
              >
                ×
              </button>
            </div>

            <form
              className="add-menu-form"
              onSubmit={handleSubmitMenuItem}
            >
              <div className="form-group">
                <label htmlFor="name">
                  Food or drink name
                </label>

                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  placeholder="Example: Cactus Latte"
                  disabled={menuWritesLocked || saving}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="category">Category</label>

                <input
                  id="category"
                  type="text"
                  value={category}
                  onChange={(event) => {
                    const nextCategory = event.target.value;
                    setCategory(nextCategory);
                    if (
                      isSizeVariantCategory(nextCategory)
                      && !sizePrices["8oz"]
                      && price
                    ) {
                      setSizePrices((current) => ({
                        ...current,
                        "8oz": price,
                      }));
                    }
                  }}
                  placeholder="Example: Coffee"
                  disabled={menuWritesLocked || saving}
                  required
                />
              </div>

              <div className="form-group form-group-wide">
                <label htmlFor="description">
                  Description
                </label>

                <textarea
                  id="description"
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  placeholder="Describe the food or drink..."
                  rows="4"
                  disabled={menuWritesLocked || saving}
                  required
                />
              </div>

              {isSizeVariantCategory(category) ? (
                drinkSizes.map((size) => (
                  <div className="form-group" key={size}>
                    <label htmlFor={`price-${size}`}>{size} Price</label>

                    <div className="price-input">
                      <span>₱</span>
                      <input
                        id={`price-${size}`}
                        type="number"
                        min="0"
                        max="1000000"
                        step="0.01"
                        value={sizePrices[size]}
                        onChange={(event) => {
                          const nextPrice = event.target.value;
                          setSizePrices((current) => ({
                            ...current,
                            [size]: nextPrice,
                          }));
                          if (size === "8oz") setPrice(nextPrice);
                        }}
                        placeholder="145"
                        disabled={menuWritesLocked || saving}
                        required
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="form-group">
                  <label htmlFor="price">Price</label>

                  <div className="price-input">
                    <span>₱</span>

                    <input
                      id="price"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      value={price}
                      onChange={(event) =>
                        setPrice(event.target.value)
                      }
                      placeholder="145"
                      disabled={menuWritesLocked || saving}
                      required
                    />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="imageUrl">
                  Product image URL
                  <span>Optional</span>
                </label>

                <input
                  id="imageUrl"
                  type="url"
                  value={imageUrl}
                  onChange={(event) =>
                    setImageUrl(event.target.value)
                  }
                  placeholder="https://..."
                  disabled={menuWritesLocked || saving}
                />
              </div>

              <div className="form-options">
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(event) =>
                      setFeatured(event.target.checked)
                    }
                    disabled={menuWritesLocked || saving}
                  />

                  <span className="checkbox-box">✓</span>

                  <span>
                    <strong>Featured item</strong>
                    <small>Show in Featured today</small>
                  </span>
                </label>

                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={popular}
                    onChange={(event) =>
                      setPopular(event.target.checked)
                    }
                    disabled={menuWritesLocked || saving}
                  />

                  <span className="checkbox-box">✓</span>

                  <span>
                    <strong>Popular item</strong>
                    <small>Show a Popular badge</small>
                  </span>
                </label>

                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={available}
                    onChange={(event) =>
                      setAvailable(event.target.checked)
                    }
                    disabled={menuWritesLocked || saving}
                  />

                  <span className="checkbox-box">✓</span>

                  <span>
                    <strong>Available to order</strong>
                    <small>Customers cannot order unavailable items</small>
                  </span>
                </label>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="cancel-form-button"
                  onClick={resetForm}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="save-menu-button"
                  disabled={saving || menuWritesLocked}
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Update product"
                      : "Save product"}
                </button>
              </div>
            </form>
          </section>
        )}

        {loadError && (
          <section className="admin-menu-error" role="alert">
            <span>!</span>
            <p>{loadError}</p>

            <button
              type="button"
              onClick={loadMenuItems}
            >
              Try again
            </button>
          </section>
        )}

        <section className="menu-library">
          <div className="library-heading">
            <div>
              <p className="admin-menu-eyebrow">
                PRODUCT LIBRARY
              </p>

              <h2>Your menu products</h2>
            </div>

            <span className="library-count">
              {visibleItems.length} of {menuItems.length}
            </span>
          </div>

          <div className="menu-library-toolbar">
            <div className="category-tabs">
              {categories.map((itemCategory) => (
                <button
                  type="button"
                  key={itemCategory}
                  className={`category-tab ${
                    selectedCategory === itemCategory
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    setSelectedCategory(itemCategory)
                  }
                >
                  {itemCategory}
                </button>
              ))}
            </div>

            <label className="menu-search">
              <span>⌕</span>

              <input
                type="search"
                placeholder="Search products"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
              />
            </label>
            <label className="availability-filter">
              <span>Availability</span>
              <select
                value={selectedAvailability}
                onChange={(event) => setSelectedAvailability(event.target.value)}
              >
                <option value="all">All items</option>
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
          </div>

          {menuItems.length === 0 ? (
            <section className="admin-menu-empty">
              <div className="empty-icon">✦</div>

              <p className="admin-menu-eyebrow">
                PRODUCT LIBRARY
              </p>

              <h2>Your menu is waiting</h2>

              <p>
                Add your first product so customers can start
                ordering.
              </p>

              <button
                type="button"
                className="add-menu-button"
                disabled={menuWritesLocked}
                onClick={openAddForm}
              >
                + Add first product
              </button>
            </section>
          ) : visibleItems.length === 0 ? (
            <section className="admin-menu-empty compact-empty">
              <div className="empty-icon">⌕</div>
              <h2>No products found</h2>
              <p>
                Try another search term or category.
              </p>
            </section>
          ) : (
            <div className="admin-menu-grid">
              {visibleItems.map((item) => (
                <article
                  className={`admin-menu-card ${
                    item.featured ? "featured-card" : ""
                  }`}
                  key={item.id}
                >
                  <div className="menu-card-image">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} />
                    ) : (
                      <span>☕</span>
                    )}

                    <div className="menu-card-badges">
                      {item.featured && (
                        <span className="featured-badge">
                          Featured
                        </span>
                      )}

                      {item.popular && (
                        <span className="popular-badge">
                          Popular
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="menu-card-content">
                    <p className="menu-category">
                      {item.category || "Uncategorized"}
                    </p>

                    <h3>{item.name}</h3>

                    <p className="menu-description">
                      {item.description}
                    </p>

                    <div className="menu-card-footer">
                      <strong>
                        {formatPrice(item.price)}
                      </strong>

                      <span className="menu-item-id">
                        #{item.id.slice(0, 6)}
                      </span>
                    </div>
                    <span
                      className={`menu-availability ${
                        item.available === false ? "unavailable" : "available"
                      }`}
                    >
                      <span aria-hidden="true" />
                      {item.available === false ? "Unavailable" : "Available"}
                    </span>
                  </div>

                  <div className="menu-card-toggles">
                    <button
                      type="button"
                      className={`menu-card-toggle availability-toggle ${
                        item.available === false ? "is-unavailable" : "is-available"
                      }`}
                      aria-pressed={item.available !== false}
                      disabled={
                        menuWritesLocked
                        || updatingItemIds.has(item.id)
                        || deletingId === item.id
                      }
                      onClick={() => handleToggleMenuItem(item, "available")}
                    >
                      {updatingItemIds.has(item.id)
                        ? "Updating..."
                        : item.available === false ? "Set Available" : "Set Unavailable"}
                    </button>
                    <button
                      type="button"
                      className={`menu-card-toggle featured-toggle ${
                        item.featured ? "is-featured" : ""
                      }`}
                      aria-pressed={item.featured === true}
                      disabled={
                        menuWritesLocked
                        || updatingItemIds.has(item.id)
                        || deletingId === item.id
                      }
                      onClick={() => handleToggleMenuItem(item, "featured")}
                    >
                      {updatingItemIds.has(item.id)
                        ? "Updating..."
                        : item.featured ? "Not Featured" : "Set Featured"}
                    </button>
                  </div>

                  <div className="menu-card-actions">
                    <button
                      type="button"
                      className="edit-button"
                      disabled={
                        menuWritesLocked
                        || updatingItemIds.has(item.id)
                        || deletingId === item.id
                      }
                      onClick={() =>
                        handleEditMenuItem(item)
                      }
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="delete-button"
                      disabled={
                        menuWritesLocked
                        || deletingId === item.id
                        || updatingItemIds.has(item.id)
                      }
                      onClick={() =>
                        handleDeleteMenuItem(
                          item.id,
                          item.name
                        )
                      }
                    >
                      {deletingId === item.id
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </main>
  );
}

export default AdminMenu;