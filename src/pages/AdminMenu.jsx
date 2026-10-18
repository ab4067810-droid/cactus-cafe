import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminMenu.css";

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

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [featured, setFeatured] = useState(false);
  const [popular, setPopular] = useState(false);
  const [available, setAvailable] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

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
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        try {
          await loadMenuItems();
        } finally {
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
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

      return matchesCategory && matchesSearch;
    });
  }, [menuItems, searchTerm, selectedCategory]);

  const resetForm = () => {
    setName("");
    setCategory("");
    setDescription("");
    setPrice("");
    setImageUrl("");
    setFeatured(false);
    setPopular(false);
    setAvailable(true);
    setEditingId(null);
    setShowForm(false);
  };

  const openAddForm = () => {
    setEditingId(null);
    setName("");
    setCategory("");
    setDescription("");
    setPrice("");
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

    if (
      !name.trim() ||
      !category.trim() ||
      !description.trim() ||
      !price
    ) {
      alert("Please complete all required fields.");
      return;
    }

    const numericPrice = Number(price);

    if (
      Number.isNaN(numericPrice) ||
      numericPrice < 0
    ) {
      alert("Please enter a valid price.");
      return;
    }

    try {
      setSaving(true);

      const itemData = {
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        price: numericPrice,
        imageUrl: imageUrl.trim(),
        featured,
        popular,
        available,
      };

      if (editingId) {
        await updateDoc(
          doc(db, "menuItems", editingId),
          {
            ...itemData,
            updatedAt: serverTimestamp(),
          }
        );

        alert("Menu item updated successfully! 🌵");
      } else {
        await addDoc(collection(db, "menuItems"), {
          ...itemData,
          createdAt: serverTimestamp(),
        });

        alert("Menu item added successfully! 🌵");
      }

      resetForm();
      await loadMenuItems();
    } catch (error) {
      console.error("Error saving menu item:", error);
      alert("Unable to save menu item. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleEditMenuItem = (item) => {
    setEditingId(item.id);
    setName(item.name || "");
    setCategory(item.category || "");
    setDescription(item.description || "");
    setPrice(
      item.price !== undefined
        ? String(item.price)
        : ""
    );
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
    const confirmed = window.confirm(
      `Are you sure you want to delete "${itemName}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(id);

      await deleteDoc(doc(db, "menuItems", id));

      alert("Menu item deleted successfully! 🌵");
      await loadMenuItems();
    } catch (error) {
      console.error("Error deleting menu item:", error);
      alert(
        "Unable to delete menu item. Please try again."
      );
    } finally {
      setDeletingId(null);
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
      <div className="admin-menu-container">
        <header className="admin-menu-header">
          <div>
            <p className="admin-menu-eyebrow">
              CAFE CATALOG
            </p>

            <h1>Menu management</h1>

            <p>
              Keep your customer menu fresh, organized, and
              ready to order.
            </p>
          </div>

          <button
            type="button"
            className="admin-back-button"
            onClick={() => navigate("/admin")}
          >
            ← Back to dashboard
          </button>
        </header>

        <section className="menu-overview">
          <div className="menu-overview-stat">
            <span>Total products</span>
            <strong>{menuItems.length}</strong>
          </div>

          <div className="menu-overview-divider" />

          <div className="menu-overview-stat">
            <span>Categories</span>
            <strong>{categories.length - 1}</strong>
          </div>

          <div className="menu-overview-divider" />

          <div className="menu-overview-stat">
            <span>Featured items</span>
            <strong>
              {menuItems.filter((item) => item.featured).length}
            </strong>
          </div>

          <button
            type="button"
            className="add-menu-button"
            onClick={() => {
              showForm ? resetForm() : openAddForm();
            }}
          >
            {showForm ? "Cancel" : "+ Add product"}
          </button>
        </section>

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
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="category">Category</label>

                <input
                  id="category"
                  type="text"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value)
                  }
                  placeholder="Example: Coffee"
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
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="price">Price</label>

                <div className="price-input">
                  <span>₱</span>

                  <input
                    id="price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(event) =>
                      setPrice(event.target.value)
                    }
                    placeholder="145"
                    required
                  />
                </div>
              </div>

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
                  disabled={saving}
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
                  </div>

                  <div className="menu-card-actions">
                    <button
                      type="button"
                      className="edit-button"
                      onClick={() =>
                        handleEditMenuItem(item)
                      }
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="delete-button"
                      disabled={deletingId === item.id}
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
    </main>
  );
}

export default AdminMenu;