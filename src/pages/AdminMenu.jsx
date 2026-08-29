import { useEffect, useState } from "react";
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

function AdminMenu() {
  const navigate = useNavigate();

  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  // =========================
  // LOAD MENU ITEMS
  // =========================
  const loadMenuItems = async () => {
    try {
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
    }
  };

  // =========================
  // CHECK LOGIN
  // =========================
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
  }, [navigate]);

  // =========================
  // RESET FORM
  // =========================
  const resetForm = () => {
    setName("");
    setCategory("");
    setDescription("");
    setPrice("");
    setEditingId(null);
    setShowForm(false);
  };

  // =========================
  // ADD / UPDATE MENU ITEM
  // =========================
  const handleSubmitMenuItem = async (event) => {
    event.preventDefault();

    if (
      !name.trim() ||
      !category.trim() ||
      !description.trim() ||
      !price
    ) {
      alert("Please complete all fields.");
      return;
    }

    const numericPrice = Number(price);

    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      alert("Please enter a valid price.");
      return;
    }

    try {
      // =========================
      // UPDATE EXISTING ITEM
      // =========================
      if (editingId) {
        const menuItemRef = doc(
          db,
          "menuItems",
          editingId
        );

        await updateDoc(menuItemRef, {
          name: name.trim(),
          category: category.trim(),
          description: description.trim(),
          price: numericPrice,
          updatedAt: serverTimestamp(),
        });

        alert(
          "Menu item updated successfully! 🌵"
        );
      }

      // =========================
      // ADD NEW ITEM
      // =========================
      else {
        await addDoc(
          collection(db, "menuItems"),
          {
            name: name.trim(),
            category: category.trim(),
            description: description.trim(),
            price: numericPrice,
            createdAt: serverTimestamp(),
          }
        );

        alert(
          "Menu item added successfully! 🌵"
        );
      }

      resetForm();
      await loadMenuItems();

    } catch (error) {
      console.error(
        "Error saving menu item:",
        error
      );

      alert(
        "Unable to save menu item. Please try again."
      );
    }
  };

  // =========================
  // EDIT MENU ITEM
  // =========================
  const handleEditMenuItem = (item) => {
    setEditingId(item.id);

    setName(item.name || "");
    setCategory(item.category || "");
    setDescription(item.description || "");
    setPrice(
      item.price !== undefined
        ? item.price.toString()
        : ""
    );

    setShowForm(true);

    // Scroll to the form
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // =========================
  // DELETE MENU ITEM
  // =========================
  const handleDeleteMenuItem = async (
    id,
    itemName
  ) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${itemName}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteDoc(
        doc(db, "menuItems", id)
      );

      alert(
        "Menu item deleted successfully! 🌵"
      );

      await loadMenuItems();

    } catch (error) {
      console.error(
        "Error deleting menu item:",
        error
      );

      alert(
        "Unable to delete menu item. Please try again."
      );
    }
  };

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="admin-menu-page">
        <p>Loading menu...</p>
      </main>
    );
  }

  // =========================
  // PAGE
  // =========================
  return (
    <main className="admin-menu-page">
      <div className="admin-menu-container">

        {/* HEADER */}
        <header className="admin-menu-header">
          <div>
            <p className="admin-menu-eyebrow">
              CACTUS CAFE
            </p>

            <h1>
              Menu Management
            </h1>

            <p>
              Add, edit, and manage Cactus Cafe
              menu items.
            </p>
          </div>

          <button
            className="admin-back-button"
            onClick={() =>
              navigate("/admin")
            }
          >
            ← Back to Dashboard
          </button>
        </header>

        {/* ADD BUTTON */}
        <section className="admin-menu-actions">
          <button
            className="add-menu-button"
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setEditingId(null);
                setName("");
                setCategory("");
                setDescription("");
                setPrice("");
                setShowForm(true);
              }
            }}
          >
            {showForm
              ? "Cancel"
              : "+ Add Menu Item"}
          </button>
        </section>

        {/* ADD / EDIT FORM */}
        {showForm && (
          <section className="add-menu-form-section">

            <h2>
              {editingId
                ? "Edit Menu Item"
                : "Add New Menu Item"}
            </h2>

            <form
              className="add-menu-form"
              onSubmit={handleSubmitMenuItem}
            >

              {/* NAME */}
              <div className="form-group">
                <label htmlFor="name">
                  Food / Drink Name
                </label>

                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(event) =>
                    setName(
                      event.target.value
                    )
                  }
                  placeholder="Example: Cactus Latte"
                  required
                />
              </div>

              {/* CATEGORY */}
              <div className="form-group">
                <label htmlFor="category">
                  Category
                </label>

                <input
                  id="category"
                  type="text"
                  value={category}
                  onChange={(event) =>
                    setCategory(
                      event.target.value
                    )
                  }
                  placeholder="Example: Coffee"
                  required
                />
              </div>

              {/* DESCRIPTION */}
              <div className="form-group">
                <label htmlFor="description">
                  Description
                </label>

                <textarea
                  id="description"
                  value={description}
                  onChange={(event) =>
                    setDescription(
                      event.target.value
                    )
                  }
                  placeholder="Describe the food or drink..."
                  rows="3"
                  required
                />
              </div>

              {/* PRICE */}
              <div className="form-group">
                <label htmlFor="price">
                  Price (₱)
                </label>

                <input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(event) =>
                    setPrice(
                      event.target.value
                    )
                  }
                  placeholder="145"
                  required
                />
              </div>

              {/* FORM BUTTONS */}
              <button
                type="submit"
                className="save-menu-button"
              >
                {editingId
                  ? "Update Menu Item"
                  : "Save Menu Item"}
              </button>

              {editingId && (
                <button
                  type="button"
                  className="admin-back-button"
                  onClick={resetForm}
                >
                  Cancel Edit
                </button>
              )}

            </form>
          </section>
        )}

        {/* MENU ITEMS */}
        {menuItems.length === 0 ? (
          <section className="admin-menu-empty">

            <div>🍔</div>

            <h2>
              No Menu Items Yet
            </h2>

            <p>
              Add your first menu item using
              the button above.
            </p>

          </section>
        ) : (
          <section className="admin-menu-grid">

            {menuItems.map((item) => (
              <article
                className="admin-menu-card"
                key={item.id}
              >

                <span className="menu-category">
                  {item.category}
                </span>

                <h2>
                  {item.name}
                </h2>

                <p>
                  {item.description}
                </p>

                <strong>
                  ₱{item.price}
                </strong>

                {/* ACTION BUTTONS */}
                <div className="menu-card-actions">

                  <button
                    onClick={() =>
                      handleEditMenuItem(item)
                    }
                  >
                    Edit
                  </button>

                  <button
                    onClick={() =>
                      handleDeleteMenuItem(
                        item.id,
                        item.name
                      )
                    }
                  >
                    Delete
                  </button>

                </div>

              </article>
            ))}

          </section>
        )}

      </div>
    </main>
  );
}

export default AdminMenu;