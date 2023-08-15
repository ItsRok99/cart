import requests
import uuid
import bson
BASE_URL = "http://localhost:3032"
TOKEN = ""  # You can set your token value here

headers = {
    "Authorization": f"Bearer {TOKEN}"
}

def generate_cart():
    return {
        "_id": str(bson.ObjectId()),
        "user_id": str(bson.ObjectId()),
        "products_id": [str(bson.ObjectId()) for _ in range(3)]
    }

def generate_product():
    return {
        "_id": str(bson.ObjectId()),
        "name": "Sample Product",
        "price": 100.50,
        "description": "This is a sample product description."
    }

def generate_cart_item():
    return {
        "id": str(bson.ObjectId()),
        "name": "Sample Cart Item",
        "price": 50.25,
        "quantity": 2
    }

endpoints = [
    ("post", "/carts", generate_cart()),
    ("get", "/carts/user/:user_id", str(bson.ObjectId())),
    ("get", "/carts/:id", str(bson.ObjectId())),
    ("put", "/carts/:id", generate_cart()),
    ("get", "/carts", None),
    ("get", "/carts/product/:productId", str(bson.ObjectId())),
    ("delete", "/carts/:id", str(bson.ObjectId())),
    ("delete", "/carts", None),
]

def test_endpoint(method, endpoint, data):
    url = BASE_URL + endpoint
    response = requests.request(method, url, headers=headers, json=data)
    
    print(f"Testing {method.upper()} {endpoint}")
    print("Status Code:", response.status_code)
    try:
        print("Response:", response.json())
    except:
        print("Response:", response.text)
    print("="*50)

for method, endpoint, data in endpoints:
    test_endpoint(method, endpoint, data)
