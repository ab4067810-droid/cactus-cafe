import { createContext, useContext, useState } from "react";

const CartContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const getCartItemKey = (item) => (
  `${item.id}_${item.selectedSize || "default"}`
);

export function CartProvider({ children }) {
  const [cart, setCart] = useState([]);
  const [cartChangeKey, setCartChangeKey] = useState(0);

  const addToCart = (item) => {
    setCart((currentCart) => {
      const existingItem = currentCart.find(
        (cartItem) => getCartItemKey(cartItem) === getCartItemKey(item)
      );

      if (existingItem) {
        return currentCart.map((cartItem) =>
          getCartItemKey(cartItem) === getCartItemKey(item)
            ? {
                ...cartItem,
                quantity: cartItem.quantity + 1,
              }
            : cartItem
        );
      }

      return [
        ...currentCart,
        {
          ...item,
          quantity: 1,
        },
      ];
    });
    setCartChangeKey((key) => key + 1);
  };

  const increaseQuantity = (cartItemKey) => {
    setCart((currentCart) =>
      currentCart.map((item) =>
        getCartItemKey(item) === cartItemKey
          ? {
              ...item,
              quantity: item.quantity + 1,
            }
          : item
      )
    );
    setCartChangeKey((key) => key + 1);
  };

  const decreaseQuantity = (cartItemKey) => {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          getCartItemKey(item) === cartItemKey
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (cartItemKey) => {
    setCart((currentCart) =>
      currentCart.filter((item) => getCartItemKey(item) !== cartItemKey)
    );
  };

  const clearCart = () => {
    setCart([]);
  };

  const totalItems = cart.reduce(
    (total, item) => total + item.quantity,
    0
  );

  return (
    <CartContext.Provider
      value={{
        cart,
        totalItems,
        cartChangeKey,
        addToCart,
        increaseQuantity,
        decreaseQuantity,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

// Cart hooks and providers are intentionally colocated with their context.
// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const cartContext = useContext(CartContext);

  if (!cartContext) {
    throw new Error("useCart must be used within a CartProvider.");
  }

  return cartContext;
}
